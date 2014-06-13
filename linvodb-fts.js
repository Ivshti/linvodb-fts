var natural = require("natural");
var _ = require("lodash");
var traverse = require("traverse");
var Autocomplete = require("autocomplete");
var partialSort = require("./partial-sort").partialSort;
/*
 * TODO: do this in a separate thread?
 * TODO: more class-oriented structure, e.g. indexes to have .getDocuments(indexName, token) or something
 */

function LinvoFTS()
{
	var self = this;
	
	var indexes = self.__indexes = { };
	var completer = self.__completer = Autocomplete.connectAutocomplete();

	/* External interfaces
	 */
	self.index = function(doc, idxCfg) {
		var docIdx = getDocumentIndex(doc, idxCfg);
		_.merge(indexes, docIdx);
		if (docIdx.idxExact) _.each(docIdx.idxExact, function(val, token) { completer.addElement(token) });
	};
	self.query = function(query, callback) { 
		return callback(null, applyQueryString(indexes, completer, query));
	};

	return this;
};

/*
 *  Default indexing rules: do n-grams only on titles, also pass title: true to ensure we don't apply stopwords to exact index
 * Also, some system to crawl through a field which we have requested for indexing and retrieve all it's strings (and merge the results)
 */
function getDocumentIndex(doc, idxConf)
{
	var idx = { }, docTrav = traverse(doc);

	// For each field in idxConf, run getFieldIndex and merge into idx	
	_.each(idxConf, function(fieldCfg, key)
	{
		var field = docTrav.get(key.split("."));
		if (! field) return;
		
		// Get leaf strings
		var strings = [];
		traverse(field).forEach(function(n)
		{
			if (this.isLeaf && typeof(n)=="string")
				strings.push(n);
		});
		
		strings.forEach(function(str) { 
			var fieldIdx = getFieldIndex(str, _.extend({ fraction: strings.length }, fieldCfg));
			mergeIndexes([ idx, attachDocScoreMap(fieldIdx, doc.id, key) ]);
		});
	});

	return idx;
};

var tokenizer = new natural.WordTokenizer(),
	stopwords = _.zipObject(natural.stopwords),
	notStopWord = function(t) { return !stopwords.hasOwnProperty(t) },
	stemmer = natural.PorterStemmer.stem,
	metaphone = natural.Metaphone.process,
	NGrams = natural.NGrams;

function getFieldIndex(field, fieldConf)
{
	/* 
	 * TODO: shorthands: 
	 * 		{ title: true } disables stopwords, 
	 * 		{ exact: true } disables all those and only indexes exact terms 
	*/
	var opts = _.extend({
		stopwords: true, // false for titles, at least for the exact index
		stemmer: true,
		metaphone: true,
		bigram: false,
		trigram: false,
		boost: 1,
		fraction: 1 // for the vector space model, if this string is a fraction of an indexed field (e.g. array), divide by how many strings we have
	}, fieldConf || { });
		
	/*
	 * NOTE: it would be great if we somehow apply this pipeline dynamically
	 */
	var tokens = tokenizer.tokenize(field.toLowerCase()), exactTokens;
	if (opts.title) exactTokens = [].concat(tokens);
	if (opts.stopwords) tokens = tokens.filter(notStopWord);
	if (!opts.title) exactTokens = [].concat(tokens);
	
	if (opts.stemmer) tokens =_.map(tokens, stemmer); // TODO: multi-lingual
	if (opts.metaphone) tokens = _.map(tokens, function(t) { return metaphone(t) });

	var jn = function(t) { return t.join(" ") }, score = getTokensScoring.bind(null, opts);
	
	var res = {};
	res.idx = score(tokens);
	res.idxExact = score(exactTokens.filter(notStopWord)); // never index stop words here; only on bi/tri-grams if we have a title
	if (opts.bigram) {
		res.idxBigram = score(NGrams.bigrams(tokens).map(jn), tokens);
		res.idxExactBigram = score(NGrams.bigrams(exactTokens).map(jn), exactTokens);
	}
	if (opts.trigram) {
		res.idxTrigram = score(NGrams.trigrams(tokens).map(jn), tokens);
		res.idxExactTrigram = score(NGrams.trigrams(exactTokens).map(jn), exactTokens);
	}
	return res;
};

function getTokensScoring(opts, tokens, origTokens)
{
	return _.zipObject(tokens, tokens.map(function(token, i) {
		// Calculate score
		// For now, we assume all tokens are equally important; in the future, we'll have TD-IDF's
		var tVec = token.split(" ");
		return ((_.intersection(tVec, origTokens || tokens).length / (tVec.length * tokens.length * opts.fraction)) + 1) * opts.boost;
	}));
};

function attachDocScoreMap(idx, id, key)
{
	_.each(idx, function(index) {
		_.each(index, function(val, token) {
			var tuple = {};
			tuple[id] = val;
			tuple["__"+key] = 1; // keep stats on which keys is this token retrieved from
			index[token] = tuple;
		});
	});
	return idx;
};

function mergeIndexes(indexes)
{
	// like _.merge, but sum integers
	return _.merge.apply(null, indexes.concat(function(a, b) {
		return (typeof(a) == "number" && typeof(b) == "number") ? a+b : undefined
	}));
};

function applyQueryString(indexes, completer, queryStr)
{
	/* 
	 * Supplementing the query with suggestions ensures we can do instant search-style queries
	 */
	var idxQuery = getFieldIndex(queryStr, { bigram: true, trigram: true, title: true });
	
	var tokens = tokenizer.tokenize(queryStr.toLowerCase()),
		token = function(i) { return tokens[tokens.length+i] },
		suggestions = null;
	
	// don't apply suggestions if the user is about to type another word - last one is complete
	if (! queryStr.match(" $")) suggestions = completer.search(tokens.pop());
	if (suggestions && suggestions.length > 1) suggestions.forEach(function(suggestion, i)
	{
		// boost the first suggestion
		var score = ( i==0 ? 2 : 1 ) / Math.min(20, suggestions.length);
		
		if (suggestions.length < 100) idxQuery.idxExact[suggestion] = score;
		if (token(-1)) idxQuery.idxExactBigram[ token(-1)+" "+suggestion ] = score*2; // s+1 / suggestions.length
		if (token(-2)) idxQuery.idxExactTrigram[ token(-2)+" "+token(-1)+" "+suggestion ] = score*3;
	});
	
	return applyQuery(indexes, idxQuery); // The indexes we will walk for that query
};

function applyQuery(indexes, idxQuery)
{
	var idxTrav = traverse(indexes);
	var resMap = {}; // The results map (ID -> score)

	traverse(idxQuery).forEach(function(searchTokenScore) {
		if (!this.isLeaf || isNaN(searchTokenScore)) return; // We're interested only in leaf nodes (token scores)
		
		var indexBoost = 1;
		if (this.path[0].match("Bigram")) indexBoost = 3;
		if (this.path[0].match("Trigram")) indexBoost = 5;
		
		var indexedScores = idxTrav.get(this.path) || { };
		_.each(indexedScores, function(score, id) {
			if (id[0] == "_") return; // special case, ID's cannot begin with _, that's metadata
			if (! resMap[id]) resMap[id] = 0;
			//resMap[id] += score * (searchTokenScore+1)*(searchTokenScore+1);
			resMap[id] += (score /* * searchTokenScore*/ * indexBoost); // Think of the model here?
		});
	});
	
	var scorePairs = [];
	_.each(resMap, function(val, key) { scorePairs.push({ id: key, score: val }) });
	return partialSort(scorePairs, "score", 100);
};



module.exports = LinvoFTS;

/*
 * Current res: 3 docs by title take 11ms to index, 12ms for 6 docs (15ms on iMac)
 */

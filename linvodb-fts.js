var natural = require("natural");
var _ = require("lodash");
var traverse = require("traverse");
var Autocomplete = require("autocomplete");
var partialSort = require("./partial-sort").partialSort;
var Unidecoder = require("stringex/lib/unidecoder");


var SUGGESTIONS_MAX_FRACTION = 10;
var SUGGESTIONS_MAX = 30;

function LinvoFTS()
{
	var self = this;
	
	var indexes = self.__indexes = { 
		idx: {},
		idxBigram: {}, idxTrigram: {}
	};
	var completer = self.__completer = Autocomplete.connectAutocomplete();

	/* External interfaces
	 */
	self.index = function(doc, idxCfg) {
		self.add(doc.id, self.get(doc,idxCfg));
	};
	self.get = function(doc, idxCfg) { return getDocumentIndex(doc, idxCfg) };
	self.add = function(id, docIdx) {
		// Consider using a raw hashmap for indexes, it will be more efficient
		for (k1 in docIdx) {
			var didx = docIdx[k1]; var idx = indexes[k1];
			for (keyword in didx) { 
				if (! idx[keyword]) idx[keyword] = {};
				idx[keyword][id] = didx[keyword];
			};
		};
		if (docIdx.idx) _.each(docIdx.idx, function(val, token) { 
			if (token.length>1) completer.addElement(token);
		});
	};
	self.query = function(query, callback) { 
		if (! (query && query.length)) return callback(new Error("Provide a search query"));
		return callback(null, applyQueryString(indexes, completer, query));
	};

	return this;
};

/*
 *  Default indexing rules: do n-grams only on titles, also pass title: true to ensure we don't apply stopwords to index
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
			mergeIndexes([ idx, fieldIdx ]);
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
 	*/
	var opts = _.extend({
		stopwords: true, // false for titles
		//stemmer: true,
		//metaphone: true,
		bigram: true,
		trigram: false,
		boost: 1,
		fraction: 1 // for the vector space model, if this string is a fraction of an indexed field (e.g. array), divide by how many strings we have
	}, fieldConf || { });
		
	/*
	 * NOTE: it would be great if we somehow apply this pipeline dynamically
	 */
	var tokens = tokenizer.tokenize(Unidecoder.decode(field).toLowerCase());
	if (opts.stopwords && !opts.title) tokens = tokens.filter(notStopWord);	

	// This will be implemented in a different way
	//if (opts.stemmer) tokens =_.map(tokens, stemmer); // TODO: multi-lingual
	//if (opts.metaphone) tokens = _.map(tokens, function(t) { return metaphone(t) });

	var jn = function(t) { return t.join(" ") }, score = getTokensScoring.bind(null, opts);
	
	var res = {};
	res.idx = score(tokens);
	if (opts.bigram) {
		res.idxBigram = score(NGrams.bigrams(tokens).map(jn), tokens);
	}
	if (opts.trigram) {
		res.idxTrigram = score(NGrams.trigrams(tokens).map(jn), tokens);
	}
	return res;
};

function getTokensScoring(opts, tokens, origTokens)
{
	// BUG: what happens if we have a token twice? the second one will override first one's score, instead of having them added
	return _.zipObject(tokens, tokens.map(function(token, i) {
		// Calculate score
		// For now, we assume all tokens are equally important; in the future, we'll have TD-IDF's
		var tVec = token.split(" ");
		return opts.boost * ( 1 + ( // TODO: instead of doing a +1 here, do this when searching (we do it so we can multiply scores to boost
			(_.intersection(tVec, origTokens || tokens).length + tokens.length-i) / 
			(tVec.length * tokens.length * opts.fraction)
		));
	}));
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
	traverse(idxQuery).forEach(function(val) {
		if (this.isLeaf && typeof(val)=="number") this.update(1);
	});

	var tokens = tokenizer.tokenize(queryStr.toLowerCase()),
		token = function(i) { return tokens[tokens.length+i] },
		lastToken = tokens.pop(),
		suggestions = null;
	
	// don't apply suggestions if the user is about to type another word - last one is complete
	if (completer && !queryStr.match(" $") && lastToken) suggestions = completer.search(lastToken).slice(0, SUGGESTIONS_MAX);
	if (suggestions && suggestions.length > 0) suggestions.forEach(function(suggestion, i)
	{
		if (suggestion == lastToken) return; // don't override the searches for the original token

		//var score = 1 / Math.max(SUGGESTIONS_MAX_FRACTION, suggestions.length);
		var score = 0.5;

		idxQuery.idx[suggestion] = score; // those are the heavy look-ups, so do them only if we're under SUGGESTIONS_MAX
		if (token(-1)) idxQuery.idxBigram[ token(-1)+" "+suggestion ] = score*2; // s+1 / suggestions.length
		if (token(-2)) idxQuery.idxTrigram[ token(-2)+" "+token(-1)+" "+suggestion ] = score*3;
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
		if (this.path[0].match("gram")) indexBoost += (this.parent.keys.length - this.parent.keys.indexOf(this.key))/(this.parent.keys.length*2); // Include the position of the token into the calculation
		
		var indexedScores = idxTrav.get(this.path) || { };
		_.each(indexedScores, function(score, id) {
			if (id[0] == "_") return; // special case, ID's cannot begin with _, that's metadata
			if (! resMap[id]) resMap[id] = 0;
			resMap[id] += score * searchTokenScore * indexBoost;
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

var natural = require("natural");
var _ = require("lodash");
var traverse = require("traverse");

/*
 * TODO: do this in a separate thread?
 * TODO: more class-oriented structure, e.g. indexes to have .getDocuments(indexName, token) or something
 */

function LinvoFTS()
{
	var self = this;
	
	var indexes = self.__indexes = { };
	
	/* External interfaces
	 */
	self.index = function(doc, idxCfg) {
		_.merge(indexes, getDocumentIndex(doc, idxCfg));
	};
	self.query = function(query, callback) { 
		return callback(null, applyQueryString(indexes, query));
	};
	
	
	return this;
};

/*
 *  Default indexing rules: do n-grams only on titles, also pass title: true to ensure we don't apply stopwords to exact index
 * Also, some system to crawl through a field which we have requested for indexing and retrieve all it's strings (and merge the results)
 */
function getDocumentIndex(doc, idxConf)
{
	var idx = { };
	// for each field in idxConf, run getFieldIndex and merge into idx

	// TEMP test
	return mergeIndexes([
		attachDocId(getFieldIndex(doc.name, { title: true, bigram: true, trigram: true, boost: 1.5 }), doc.imdb_id),
		attachDocId(getFieldIndex(doc.description||"", { }), doc.imdb_id),  // boost?
	]
	.concat((doc.director||[]).map(function(d) { return attachDocId(getFieldIndex(d, { title: true, bigram: true, trigram: true }), doc.imdb_id) }))
	.concat((doc.cast||[]).map(function(c) { return attachDocId(getFieldIndex(c, { title: true, bigram: true, trigram: true }), doc.imdb_id) }))
	);

	return idx;
};

var tokenizer = new natural.WordTokenizer(),
	stopwords = _.zipObject(natural.stopwords),
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
		boost: 1
	}, fieldConf || { });
		
	/*
	 * NOTE: it would be great if we somehow apply this pipeline dynamically
	 */
	var tokens = tokenizer.tokenize(field.toLowerCase()), exactTokens;
	if (opts.title) exactTokens = [].concat(tokens);
	if (opts.stopwords) tokens = _.filter(tokens, function(t) { return !stopwords.hasOwnProperty(t) });
	if (!opts.title) exactTokens = [].concat(tokens);
	
	if (opts.stemmer) tokens =_.map(tokens, stemmer); // TODO: multi-lingual
	if (opts.metaphone) tokens = _.map(tokens, function(t) { return metaphone(t) });

	var jn = function(t) { return t.join(" ") };	
	
	var res = {};
	res.idx = getTokensScoring(opts.boost/*1*/, tokens);
	res.idxExact = getTokensScoring(opts.boost/*1.5*/, exactTokens);
	if (opts.bigram) {
		res.idxBigram = getTokensScoring(opts.boost/**2*/, NGrams.bigrams(tokens).map(jn), tokens);
		res.idxExactBigram = getTokensScoring(opts.boost/**2.5*/, NGrams.bigrams(exactTokens).map(jn), exactTokens);
	}
	if (opts.trigram) {
		res.idxTrigram = getTokensScoring(opts.boost/**3*/, NGrams.trigrams(tokens).map(jn), tokens);
		res.idxExactTrigram = getTokensScoring(opts.boost/**3.5*/, NGrams.trigrams(exactTokens).map(jn), exactTokens);
	}
	return res;
};

function getTokensScoring(boost, tokens, origTokens)
{
	return _.zipObject(tokens, tokens.map(function(token, i) {
		// Calculate score
		// For now, we assume all tokens are equally important; in the future, we'll have TD-IDF's
		var tVec = token.split(" ");
		return (_.intersection(tVec, origTokens || tokens).length / (tVec.length * tokens.length)) * boost;
	}));
};

function attachDocId(idx, id)
{
	_.each(idx, function(index) {
		_.each(index, function(val, token) {
			var tuple = {};
			tuple[id] = val;
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

function applyQueryString(indexes, queryStr)
{
	return applyQuery(indexes, getFieldIndex(queryStr, { bigram: true, trigram: true, title: true })); // The indexes we will walk for that query
};

function applyQuery(indexes, idxQuery)
{
	var idxTrav = traverse(indexes);
	var resMap = {}; // The results map (ID -> score)

	traverse(idxQuery).forEach(function(searchTokenScore) {
		if (!this.isLeaf || isNaN(searchTokenScore)) return; // We're interested only in leaf nodes (token scores)

		// TODO: partial queries

		var indexBoost = 1;
		if (this.path[0].match("Bigram")) indexBoost = 2;
		if (this.path[0].match("Trigram")) indexBoost = 3;
		
		var indexedScores = idxTrav.get(this.path) || { };
		_.each(indexedScores, function(score, id) {
			if (! resMap[id]) resMap[id] = 0;
			//resMap[id] += score * (searchTokenScore+1)*(searchTokenScore+1);
			resMap[id] += (score * searchTokenScore * indexBoost); // Think of the model here?
		});
	});
	
	return _.chain(resMap).pairs()
		.map(function(p) { return{ id: p[0], score: p[1] } })
		.sortBy("score")
		.reverse().value();
};



module.exports = LinvoFTS;

/*
 * Current res: 3 docs by title take 11ms to index, 12ms for 6 docs (15ms on iMac)
 */

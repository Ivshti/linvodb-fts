var natural = require("natural");
var _ = require("lodash");

/*
 * TODO: do this in a separate thread?
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
		return callback(null, query(indexes, query));
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

	var jn = function(t) { return t.join(" ") }, score = getTokensScoring.bind(null, opts);	
	
	var res = {};
	res.idx = score(tokens);
	res.idxExact = score(exactTokens);
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
		return (_.intersection(tVec, origTokens || tokens).length / (tVec.length * tokens.length)) * opts.boost;
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


function query(indexes, query)
{
	
};



module.exports = LinvoFTS;

/*
 * Current res: 3 docs by title take 11ms to index, 12ms for 6 docs (15ms on iMac)
 */

var natural = require("natural");
var _ = require("lodash");

/*
 * TODO: do this in a separate thread?
 */

function LinvoFTS()
{
	var self = this;
	
	var indexes = { };
	
	/* External interfaces
	 */
	self.index = function(doc, idxCfg) {
		_.merge(indexes, getDocumentIndex(doc, idxCfg));
	};
	self.query = function(query, callback) { 
		
	};
	
	
	return this;
};

function getDocumentIndex(doc, idxConf)
{
	
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
		bigram: true,
		trigram: true,
		boost: 1
	}, fieldConf || { });
		
	/*
	 * NOTE: it would be great if we somehow apply this pipeline dynamically
	 */
	
	var tokens = tokenizer.tokenize(field), exactTokens;
	if (opts.title) exactTokens = [].concat(tokens);
	if (opts.stopwords) tokens = _.filter(tokens, function(t) { return !stopwords.hasOwnProperty(t) });
	if (!opts.title) exactTokens = [].concat(tokens);
	
	if (opts.stemmer) tokens =_.map(tokens, stemmer); // TODO: multi-lingual
	if (opts.metaphone) tokens = _.map(tokens, function(t) { return metaphone(t) });
	
	var res = {};
	res.idx = getTokensScoring(tokens);
	res.idxExact = getTokensScoring(exactTokens);
	
	var jn = function(t) { return t.join(" ") };
	if (opts.bigram) {
		res.idxBigram = getTokensScoring(NGrams.bigrams(tokens).map(jn));
		res.idxExactBigram = getTokensScoring(NGrams.bigrams(exactTokens).map(jn));
	}
	if (opts.trigram) {
		res.idxTrigram = getTokensScoring(NGrams.trigrams(tokens).map(jn));
		res.idxExactTrigram = getTokensScoring(NGrams.trigrams(exactTokens).map(jn));
	}
	return res;
};
console.log(getFieldIndex("polly likes balloons and loves her dog sally's eyes"));
console.log(getFieldIndex("american psycho II: all american girl",{ title: true }));

function getTokensScoring(tokens, opts)
{
	// TODO
	return _.zipObject(tokens)
};

function query(indexes, query)
{
	
};


module.exports = LinvoFTS;

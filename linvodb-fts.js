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

var tokenizer = new natural.WordTokenizer();
function getFieldIndex(field, fieldConf)
{
	/* 
	 * TODO: shorthands: 
	 * 		{ title: true } disables stopwords, 
	 * 		{ exact: true } disables all those and only indexes exact terms 
	*/
	var opts = _.extend({
		stopwords: true, // false for titles
		stemmer: true,
		metaphone: true,
		ngrams: true
	}, fieldConf || { });
	
	var res = { };
	
	/*
	 * NOTE: it would be great if we somehow apply this pipeline dynamically
	 */
	
	var tokens = tokenizer.tokenize(field);
	console.log(tokens);
	console.log(_.zipObject(natural.stopwords));
	//.hasOwnProperty()
};
getFieldIndex("polly likes balloons and loves her dog sally's eyes");


function query(indexes, query)
{
	
};


module.exports = LinvoFTS;

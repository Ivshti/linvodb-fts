var mongoose = require("mongoose");
var _ = require("lodash");
var LinvoFTS = require("./linvodb-fts");

mongoose.set("cinematic-torrents-connection", process.env.LOCAL_TORRENTS_DB ? // WARNING; taken from torrentCrawler
    mongoose.createConnection("localhost", "cinematic-torrents")
    : mongoose.createConnection("mongodb://linvo:deadsnake09@ds041938-a0.mongolab.com:41938/cinematic")
);

var Metadata = mongoose.get("cinematic-torrents-connection").model("Metadata", new mongoose.Schema({ }, { collection: "metadata", strict: false }));

var textSearch = new LinvoFTS();
var metaStream = Metadata.find({ "scraper.complete": true, seeders: { $exists: true }, type: /series|movie/ })
	.sort({ seeders: -1 })/*.limit(50)*/.lean().stream();

var indexTime = 0, docsCount = 0;
metaStream.on("data", function(meta) {
	var start = Date.now(); // LOGGING
	meta.id = meta.imdb_id;
	textSearch.index(meta, {
		name: { title: true, bigram: true, trigram: true, boost: 2.5 },
		cast: { title: true, bigram: true, trigram: true },
		director: { title: true, bigram: true, trigram: true },
		writer: { title: true, bigram: true, trigram: true },
		//description: {  boost: 1, bigram: true, stemExact: true },
	});
	indexTime += (Date.now()-start); docsCount++; // LOGGING
});
	textSearch.query("game thr", function() { });

metaStream.on("close", function() { 
	//console.log(textSearch.__indexes);
	console.log("Indexing time: "+indexTime+"ms, docs: "+docsCount);

	var avgTokens = function(idx) {
		var keys = Object.keys(idx);
		return keys.map(function(t) {return Object.keys(idx[t]).length }).reduce(function(a,b){return a+b},0) / keys.length

	};	
	console.log("idx",Object.keys(textSearch.__indexes.idx).length, avgTokens(textSearch.__indexes.idx));	
	console.log("idxBigram",Object.keys(textSearch.__indexes.idxBigram).length);	
	console.log("idxTrigram",Object.keys(textSearch.__indexes.idxTrigram).length);	

	console.log("idxExact", Object.keys(textSearch.__indexes.idxExact).length);	
	console.log("idxExactBigram", Object.keys(textSearch.__indexes.idxExactBigram).length);	
	console.log("idxExactTrigram", Object.keys(textSearch.__indexes.idxExactTrigram).length);

	/* Calculate the most important bigrams contained in the description
	* A test in order to drop un-important bigrams/trigrams
	*/ 
	
	/*
	var bigrams = [];
	_.pairs(textSearch.__indexes.idxExactBigram).forEach(function(idxItem) {
		var token = idxItem[0],
			scoreMap = idxItem[1];
		if (! scoreMap.__description) return;
		var tokenScore = _.pairs(scoreMap)
			.map(function(x) { if (x[0][0]=="_") return 0; return x[1] })
			.reduce(function(a,b) {return a+b}, 0);
		bigrams.push([token, tokenScore, Object.keys(scoreMap).length]);
	});
	console.log(bigrams.sort(function(a,b){ return b[1] - a[1] }).slice(0, 400));
	return;
	*/

	console.log("Finished indexing documents");

	var queryCb = function(name) { 
		var start = Date.now();
		return function(err, res) { 
			var time = Date.now()-start;
			var resCount = res.length;
		
			// Experimental filtering
			var above = res[0].score / 2;
			res = res.filter(function(x) { return x.score > above});
	
			Metadata.find({ imdb_id: { $in: _.pluck(res.slice(0, 20), "id") } }, { name: 1, cast: 1, director: 1, imdb_id: 1 }).lean().exec(function(err, meta) {
				var meta = _.indexBy(meta, "imdb_id");
				var results =  res.slice(0, 20).map(function(x) { meta[x.id].score=x.score; return meta[x.id] });
				console.log(name, time+"ms", resCount+" results", _.map(results, function(x) { return _.pick(x, "name", "score") }));
			});
			 
		};
	};

	/*
	textSearch.query("the se", queryCb("the se"));
	textSearch.query("the secret l", queryCb("the secret l"));
	textSearch.query("the secret li", queryCb("the secret li"));
	textSearch.query("the secret life o", queryCb("the secret life o"));
	textSearch.query("the secret life of ", queryCb("the secret life of "));
	textSearch.query("the secret life of", queryCb("the secret life of"));
	*/

/*
	textSearch.query("how i me", queryCb("how i me"));	
	textSearch.query("how i m", queryCb("how i m"));
	textSearch.query("game of th", queryCb("game of t"));
	textSearch.query("game thr", queryCb("game thr"));
	textSearch.query("american ps", queryCb("american ps"));
	textSearch.query("american p", queryCb("american p"));
*/		
	textSearch.query("wall street", queryCb("wall street")); // 50 objects -> 1ms, 500 objects -> 1ms
	textSearch.query("wolf of", queryCb("wolf of"));
	textSearch.query("wolf street", queryCb("wolf street"));
	textSearch.query("wolf of wall", queryCb("wolf of wall"));
	
	textSearch.query("game of th", queryCb("game of t"));
	//textSearch.query("american ps", queryCb("american ps"));
	textSearch.query("game thr", queryCb("game thr"));


	//textSearch.query("psycho", queryCb());
	
	textSearch.query("american psycho", queryCb("american psycho")); 
	/* This query returns ianappropriate results - we have an exact match on "american psycho" bigrams with american psycho II,
	 * but because of the vector space model it's insignificant in score; exact matches should be encouraged */
	
	textSearch.query("christian bale", queryCb("christian bale"));
	

	//textSearch.query("jordan belfort", queryCb("jordan belfort"));
	textSearch.query("following", queryCb("following"));
	//textSearch.query("big bang", queryCb("big bang"));

	textSearch.query("serial killer", queryCb("serial killer"));
	
	
	//process.nextTick(function() { process.exit() });
});

// First test: 77MB for 1000 docs
// 91 MB for 3000

// 115 MB for 20 000, title+cast+directors
// ~400MB for 20 000 docs, title+desc+cast
// 730MB for 20 000 docs with bigrams for desc 

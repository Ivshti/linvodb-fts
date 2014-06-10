var mongoose = require("mongoose");
var _ = require("lodash");
var LinvoFTS = require("./linvodb-fts");

mongoose.set("cinematic-torrents-connection", process.env.LOCAL_TORRENTS_DB ? // WARNING; taken from torrentCrawler
    mongoose.createConnection("localhost", "cinematic-torrents")
    : mongoose.createConnection("mongodb://linvo:deadsnake09@ds041938-a0.mongolab.com:41938/cinematic")
);

var Metadata = mongoose.get("cinematic-torrents-connection").model("Metadata", new mongoose.Schema({ }, { collection: "metadata", strict: false }));

var textSearch = new LinvoFTS();
var metaStream = Metadata.find({ "scraper.complete": true, seeders: { $exists: true } })
	.sort({ seeders: -1 })/*.limit(500)*/.lean().stream();

var indexTime = 0, docsCount = 0;
metaStream.on("data", function(meta) {
	var start = Date.now(); // LOGGING
	textSearch.index(meta);
	indexTime += (Date.now()-start); docsCount++; // LOGGING
});
metaStream.on("close", function() { 
	//console.log(textSearch.__indexes);
	console.log("Indexing time: "+indexTime+"ms, docs: "+docsCount);
	
	console.log("idx",Object.keys(textSearch.__indexes.idx).length);	
	console.log("idxBigram",Object.keys(textSearch.__indexes.idxBigram).length);	
	console.log("idxTrigram",Object.keys(textSearch.__indexes.idxTrigram).length);	

	console.log("idxExactBigram", Object.keys(textSearch.__indexes.idxExactBigram).length);	
	console.log("idxExactTrigram", Object.keys(textSearch.__indexes.idxExactTrigram).length);	

	console.log("Finished indexing documents");
	
	var queryCb = function(name) { 
		var start = Date.now();
		return function(err, res) { 
			var time = Date.now()-start;
			Metadata.find({ imdb_id: { $in: _.pluck(res.slice(0, 20), "id") } }).lean().exec(function(err, meta) {
				var meta = _.indexBy(meta, "imdb_id");
				var results =  res.map(function(x) { return meta[x.id] || {} });
				console.log(name, time, _.pluck(results, "name"));
			});
			 
		};
	};
	textSearch.query("wolf street", queryCb("wolf street")); // 50 objects -> 1ms, 500 objects -> 1ms
	textSearch.query("wolf of wall", queryCb("wolf of wall"));
	//textSearch.query("psycho", queryCb());
	
	textSearch.query("american psycho", queryCb("american psycho")); 
	/* This query returns ianappropriate results - we have an exact match on "american psycho" bigrams with american psycho II,
	 * but because of the vector space model it's insignificant in score; exact matches should be encouraged */
	
	textSearch.query("christian bale", queryCb("christian bale"));
	textSearch.query("jordan belford", queryCb("jordan belford"));
	//textSearch.query("game th", queryCb);
	//textSearch.query("america", queryCb);
	
	
	//process.nextTick(function() { process.exit() });
});

// First test: 77MB for 1000 docs
// 91 MB for 3000
// 129 MB for ~16000 objects

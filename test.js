var mongoose = require("mongoose");
var LinvoFTS = require("./linvodb-fts");

mongoose.set("cinematic-torrents-connection", process.env.LOCAL_TORRENTS_DB ? // WARNING; taken from torrentCrawler
    mongoose.createConnection("localhost", "cinematic-torrents")
    : mongoose.createConnection("mongodb://linvo:deadsnake09@ds041938-a0.mongolab.com:41938/cinematic")
);

var Metadata = mongoose.get("cinematic-torrents-connection").model("Metadata", new mongoose.Schema({ }, { collection: "metadata", strict: false }));

var textSearch = new LinvoFTS();
var metaStream = Metadata.find({ "scraper.complete": true, seeders: { $exists: true } }).sort({ seeders: -1 }).lean().limit(3000).stream();
metaStream.on("data", function(meta) {
	textSearch.index(meta);
});
metaStream.on("close", function() { 
	//console.log(textSearch.__indexes);
	console.log("Finished indexing documents");
	//process.nextTick(function() { process.exit() });
});

// First test: 77MB for 1000 docs

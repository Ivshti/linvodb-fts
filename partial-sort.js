module.exports.partialSort = function(items, key, k) {

    function bisect(items, x, lo, hi) {
      var mid;
      if (typeof(lo) == 'undefined') lo = 0;
      if (typeof(hi) == 'undefined') hi = items.length;
      while (lo < hi) {
        mid = Math.floor((lo + hi) / 2);
        if (x[key] > items[mid][key]) hi = mid;
        else lo = mid + 1;
      }
      return lo;
    }
    
    function insort(items, x) {
      items.splice(bisect(items, x), 0, x);
    }
    
    if (! items.length) return[];
    
	var largest = items.slice(0, Math.min(items.length, k)).sort(function(a,b) { return b[key]-a[key] }),
		max = largest[largest.length-1][key];
	for (var i = k, len = items.length; i < len; ++i) {
		var item = items[i][key];
		if (item > max) {
			insort(largest, items[i]);
			largest.length = k;
			max = largest[k-1][key];
		}
	}
	return largest;    
};

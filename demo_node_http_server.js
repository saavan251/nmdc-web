
var http = require('http');
var fs=require('fs');
http.createServer(function (req, res) {
	console.log("req: "+req.url);
    fs.readFile("C:/Users/VISHAL ASHANK/Downloads"+req.url,function(error,data)
    {
    	if(error)
    	{
    		res.writeHead(404, {'Content-Type': 'text/plain'});
    		res.end("Sorry this website is not designed to suit your imaginations");
    	}
    	else
    	{
    		if (req.url === '/js/styles/styles.css') {
    		res.writeHead(200, {'Content-type' : 'text/css'});
    		var fileContents = fs.readFileSync('C:/Users/VISHAL ASHANK/Downloads/js/styles/styles.css', {encoding: 'utf8'});
    		res.write(fileContents);
    		res.end();
  				}
  				else{
    		res.writeHead(200, {'Content-Type': 'html'});
    		res.end(data);}
    	}
    });
    //res.end('');
}).listen(80,"0.0.0.0");
console.log('Server running at http://127.0.0.1:1337/');
/*var fs=require("fs");
var d=null;
fs.readFile("C:/Users/VISHAL ASHANK/Desktop/nmdc proj/first.html",function(error,data)
{
console.log(data+"hey i got it");
});

/*console.log("carry on");
var cnt=fs.readFileSync("inp.txt");
console.log(cnt+"this");*/
/*var express = require("express");
var app = express();
app.use(app.router);
app.use(express.static(__dirname + "C:/Users/VISHAL ASHANK/Desktop/nmdc proj"));
app.get("C:/Users/VISHAL ASHANK/Desktop/nmdc proj",function(r,e)
{
	response.send("hey");
});
app.listen(1337);*/
/*var hub = new require("nmdc").Nmdc({
    address: "192.168.118.11",
    auto_reconnect: true
});

hub.onConnect = function() {
    hub.say('Hi everyone!');
};

hub.onPublic = function(user, message) {
    if (user != hub.opts.nick) {
        hub.say(user + ' just said ' + message);
    }
};*/
var a=require('C:/Users/VISHAL ASHANK/Desktop/nmdc proj/nmdc-web/nmdc_module_test.js');
var hub = new a.Nmdc({
    address: "192.168.145.81",
    auto_reconnect: true,
    nick: 'black_ma',
    password: 'password_goes_here',
    clientIP: '192.168.118.164',
    active: false
});
 
hub.onConnect = function() {
    //hub.say('Hi everyone!');
    console.log('connected');
    if(hub.opts.active===true)
    hub.activeSearch('F?F?0?1?net');
	else
		hub.passiveSearch('F?F?0?1?2016');
    hub.pm('black_mamba','hello',function(){})
    //hub.pm('winchester',"sdascsc");
    //console.log(hub.search('winchester1200'));
};
hub.onPublic = function(user, message) {
    if (user != hub.opts.nick) {
        //hub.say(user + ' just said ' + message);
    }
};
hub.onSystem = function(str){
	if(str!=null)
		console.log(str);
	else
		console.log("error");
};
hub.onDebug = function(str){
	if(str!=null)
		console.log(str);
	else
		console.log("error");
};
/*
console.log("1");
setTimeout(function(){callback(1)},1000);
console.log("2");
setTimeout(function(){callback(2)},1000);
function callback(x){
	console.log("dekh bhai"+x);
}*//*
var fs=require('fs');
function getBears(filepath,done){
	fs.readFile(filepath,functin(err,bears){
		if(err)return done(err);
	fs.readFile('bear',function(err,dict){
		compareBears(bears,dict);
	})
	})
	function compareBears(bears,dict){
		dict
	}
}*//*
let x=function(){
	console.log('inslk');
};

let y=function(c){
	console.log("sjfajf");
	c();
}

y(x);*/
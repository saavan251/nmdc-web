/* _  ___  _| _    * _
  | )[ | )(_](_ *  |_)       Copyright (c) 2012-2016 -- the nmdc.js authors
                 ._|   
Permission to use, copy, modify, and/or distribute this software for any
  purpose with or without fee is hereby granted, provided that the above
  copyright notice and this permission notice appear in all copies.
*/

"use strict";
var net = require('net');
var tls = require('tls');
var dgram = require('dgram');
var fs = require('fs');
var decompress = require('decompress');
var bunzip = require('seek-bzip')

var NMDC_JS_RECONNECT_TIMEOUT = 30*1000;
var NMDC_JS_KEEPALIVE_TIMEOUT = 15*1000;

/**
 * Constructor for new Nmdc class instances.
 *
 * @class Nmdc
 * @constructor
 */
function Nmdc(options, onConnect) {

	// Simulate calling constructor with 'new' if it was omitted
	if (!(this instanceof Nmdc)) {
		return new Nmdc(options, onConnect);
	}

	// Handlers
	this.onConnect    = onConnect || function(){};
	this.onSystem     = function(s){};
	this.onPublic     = function(u,m){};
	this.onPrivate    = function(u,m){};
	this.onUserJoin   = function(u){};
	this.onUserPart   = function(u){};
	this.onUserUpdate = function(u){};
	this.onDebug      = function(s){};
	this.onClosed     = function(){};	
	this.onStateChange = function(i){};
	this.onHubNameChange = function(s){};
	this.onUserCommand= function(type, context, title, raw){};
	
	this.opts = {
		address: '127.0.0.1',
		port: 411,
		tls: false,
		password: '',
		auto_reconnect: false,
		encoding: 'utf8',		
		nick: 'nmdcjs_user',
		desc: '',
		tag: "nmdc.js 1.6",
		share: 0,
		follow_redirects: false,
		ignore_chat_failures: false,
		shouldInstantConnect: true,
		active: true
	};
	
	if (typeof(options) !== 'undefined') {
		for (var i in options) {
			this.opts[i] = options[i];
		}
	}
	
	this.users = {};
	this.hubName = '';
	
	this.nmdc_connected = false;	
	this.nmdc_partial = '';
	this.sentOurHello = false;
	
	this._reconnector = false;
	
	this.sock = null;
	this.server=null;
	this.tcps=null;
	
	if(this.opts.shouldInstantConnect){
		return this.reconnect();
	} else {
		return this;
	}
}

Nmdc.prototype.STATE_DISCONNECTED = 0;
Nmdc.prototype.STATE_CONNECTED = 1;

Nmdc.prototype.USERCOMMAND_TYPE_SEPARATOR = 0;
Nmdc.prototype.USERCOMMAND_TYPE_RAW = 1;
Nmdc.prototype.USERCOMMAND_TYPE_NICKLIMITED = 2;
Nmdc.prototype.USERCOMMAND_TYPE_CLEARALL = 255;

Nmdc.prototype.USERCOMMAND_CONTEXT_HUB = 1;
Nmdc.prototype.USERCOMMAND_CONTEXT_USER = 2;
Nmdc.prototype.USERCOMMAND_CONTEXT_SEARCH = 4;
Nmdc.prototype.USERCOMMAND_CONTEXT_FILELIST = 8;

// #################
// Methods
// #################

/**
 * Send a raw protocol message over the TCP socket. The message is not escaped
 *  and does not add a trailing pipe.
 *
 * @param {String} raw Raw data to send
 * @param {Function} cb Callback on completion
 * @return {Nmdc} Returns self for chained calls 
 */
Nmdc.prototype.raw = function(raw, cb) {
	this.onDebug("SENDING: " + raw);
	this.sock.write(raw, this.opts.encoding, cb);
	return this;
};

/**
 * Post a message to main chat.
 *
 * @param {String} message Message to send
 * @param {Function} cb Callback on completion
 * @return {Nmdc} Returns self for chained calls
 */
Nmdc.prototype.say = function(message, cb) {
	try {
		return this.raw('<'+this.opts.nick+'> '+nmdc_escape(message)+'|', cb);
	} catch (ex) {
		if (this.opts.ignore_chat_failures) {
			this.onDebug("Failed to send chat message.");
		} else {
			throw ex;
		}
	}
};

/**
 * Send a private message to a user.
 *
 * @param {String} user User nick to send message to
 * @param {String} message Message to send
 * @param {Function} cb Callback on completion
 * @return {Nmdc} Returns self for chained calls
 */
Nmdc.prototype.pm = function(user, message, cb) {
	try {
		return this.raw(
			'$To: '+user+' From: '+this.opts.nick+' $<'+this.opts.nick+'> '+
			nmdc_escape(message)+'|',
			cb
		);
	} catch (ex) {
		if (this.opts.ignore_chat_failures) {
			this.onDebug("Failed to send private message."); // do nothing
		} else {
			throw ex;
		}
	}
};

/**
 * Disconnect from the hub. Note that if you set nmdc.opts.auto_reconnect, then
 *  the hub might auto-reconnect (unless you also call setAutoReconnect(false)).
 *
 * @return {Nmdc} Returns self for chained calls
 */
Nmdc.prototype.disconnect = function() {
	if (this.sock !== null) {
		this.sock.destroy();
		this.sock = null;
	}
	
	if (this.nmdc_connected) {
		this.onClosed(); // normal disconnection event
	} else {
		if (this.sock !== null) {
			this.onDebug('Aborting incomplete connection');
		}
	}
	
	this.nmdc_connected = false;
	this.onStateChange(Nmdc.prototype.STATE_DISCONNECTED);
	return this;
};

/**
 * Configure whether the object automatically reconnects to the hub on failure.
 *
 * @param {Boolean} enable Whether to enable autoreconnect behaviour
 * @return {Nmdc} Returns self for chained calls
 */
Nmdc.prototype.setAutoReconnect = function(enable) {

	var self = this;
	this.opts.auto_reconnect = !!enable;

	if (enable && this._reconnector === false) {
		this._reconnector = setInterval(
			function() {
				if (! self.nmdc_connected) {
					self.onDebug('Reconnecting...');
					self.reconnect();
				}
			},
			NMDC_JS_RECONNECT_TIMEOUT
		);
	
	} else if (!enable && this._reconnector !== false) {
		clearInterval(this._reconnector);
		this._reconnector = false;
		
	}
	
	return this;
};

/**
 * Connect to the hub as configured by self.opts.
 *
 * @return {Nmdc} Returns self for chained calls
 */
Nmdc.prototype.reconnect = function() {
	var self = this;
	
	if (this.sock !== null) {
		this.disconnect();
	}
	
	this.sock = null;
	if (this.opts.tls) {
		this.sock = tls.connect(this.opts.port, this.opts.address);
	} else {
		this.sock = net.createConnection(this.opts.port, this.opts.address);
	}
	this.sock.setEncoding(this.opts.encoding);
	this.sock.setKeepAlive(true, NMDC_JS_KEEPALIVE_TIMEOUT);
	
	this.sock.on('connect', function() {
		self.onSystem('Connected to server.');
	});
	
	// Network errors
	
	this.sock.on('end', function() {
		self.onSystem('Connection closed.');
		self.disconnect();
	});
	
	this.sock.on('error', function(e) {
		self.onSystem('Connection error ('+e.code+')');
		self.disconnect();
	});
	
	this.sock.on('timeout', function() {
		self.onSystem('Connection timed out.');
		self.disconnect();
	});
	
	// Data
	this.sock.on('data', function(data) {
		var commands = data.split('|');
		//console.log(commands);
		// Handle protocol buffering
		commands[0] = self.nmdc_partial + commands[0];
		//console.log('partial'+self.nmdc_partial);
		self.nmdc_partial = commands[commands.length - 1];
		//console.log('partial2'+self.nmdc_partial);		
		for (var i = 0; i < commands.length - 1; i++) {
			self.nmdc_handle(commands[i]);
		}
			
	});
	
	// Handle auto reconnect
	this.setAutoReconnect(!! this.opts.auto_reconnect);
	this.onStateChange(Nmdc.prototype.STATE_CONNECTED);
	return this;
};

/**
 * Get the current connected state of the hub.
 *
 * @return {Boolean} True if is connected, false otherwise.
 */
Nmdc.prototype.getIsConnected = function() {
	return !!this.sock;
}

/**
 * Get the current hub name.
 *
 * @return {String} Hubs current name or empty string if we don't have one.
 */
Nmdc.prototype.getHubName = function() {
	return this.hubName;
}
/**Downloading active client settings
*
*/
Nmdc.prototype.activedownload=function(nick)
{

var self=this;
this.tcps=net.createServer(function(soc) {
	var sendontcp=function(value){
		console.log('SENDING: '+value);
		soc.write(value);
	}
    soc.on('data', function(data) {
    	//console.log(data);
        data=data+'';
        //console.log('DATA ' + soc.remoteAddress + ': ' + data);
        var comm = data.split('|');
        console.log('check this out'+comm[0]);
        for(var i in comm)
        {
        	//console.log(comm[i]);
        	var cmd = comm[i].split(' ')[0];
			var rem = comm[i].substr(cmd.length + 1);
        	//var splitted = comm[i].split(' ');
        	//console.log(cmd); 
        	//console.log(rem);
        if(cmd==='$MyNick')
        	sendontcp('$MyNick '+self.opts.nick+'|');
        if(cmd==='$Lock')
        {
        	var key = nmdc_locktokey(rem);
    		console.log('KEY: '+key);
			sendontcp(
				'$Lock '+rem+'|'+
				//'$Supports NoGetINFO UserCommand UserIP2 '+
				'$Supports MiniSlots XmlBZList ADCGet TTHL TTHF ZLIG|'+
				'$Direction Download 10100|'+
				'$Key '+key+'|'
			);
        }
        if(cmd==='$Key'){
        	sendontcp('$ADCGET file files.xml.bz2 0 -1 ZL1|');
        }
    }
    soc.on('error',function(err){
    	console.log(err+'');
    });
    });
    soc.on('close', function(data) {
        console.log('tcp CLOSED: ');
    });
    
}).listen(60333, '192.168.118.164');
//this.tcps.write('akdfjsdfj');
console.log('TCP Server listening');
	try{
		//console.log(this.sock.localPort+'port address');
		//photon DC\\setups\\remix\\md5sum.txt
		//Prithvipc Study(rP)\\IC.pdf
		this.raw('$ConnectToMe photon 192.168.118.164:60333|');
	}
	catch(ex){
 		this.onDebug(ex+' download me prob hai');
 	}
};

/**
* Passive downloading
*
*/
Nmdc.prototype.download=function(data){
	this.raw('$RevConnectToMe '+this.opts.nick+' sss|');


};

/**
 * Passive search
 *
 */
 Nmdc.prototype.passiveSearch = function(srch){
 	try{
 		var x= this.raw(
 			'$Search Hub:'+this.opts.nick+' '+srch+'|'
 			);
 		//this.onDebug(x);
 	}catch(ex){
 		this.onDebug(ex+' passive');
 	}

 };

 /**
  *Active search
  *
  */
  Nmdc.prototype.activeSearch = function(srch){
  	try{
  		var self=this;
  		this.server = dgram.createSocket('udp4');
		var address=null;
		/*this.server.on('error', (err) => {
		  console.log('server error: '+err.stack);
		  server.close();
		});*/
		this.server.on('message', (msg, rinfo) => {
		  console.log(msg+' ');
		});

		this.server.on('listening', () => {
		  address = this.server.address();
		  console.log('server listening ${'+address.address+'}:${'+address.port+'}');
		});
		this.server.bind({
			//address:'192.168.118.164',
			port:57263,
			exclusive: true
		},function(){
	try{
		var s='$Search '+address.address+':'+address.port+' '+srch+'|';
			self.raw(s);
 			
		}
		catch(ex)
		{
			console.log('errr');
		}
		});
		//console.log(this.server.address["address"]);
		//console.log(this.server.address["port"]);
  		
  		//this.onDebug(x);
 	}catch(ex){
 		this.onDebug(ex+' activev');
 	}

  	};

// #################
// Internal
// #################

Nmdc.prototype.nmdc_handle = function(data) {
	
	// this.onDebug(data);
	
	if (data.length === 0) {
		return this;
	}
	
	// Short-circuit public chat
	if (data[0] === '<') {
		var rpos = data.indexOf('> ');
		this.onPublic(
			data.substr(1, rpos-1),
			nmdc_unescape(data.substr(rpos+2))
		);
		return this;
	}
	
	// Short-circuit system messages
	if (data[0] !== '$') {
		this.onSystem(nmdc_unescape(data));
		return this;
	}
	
	var cmd = data.split(' ')[0];
	var rem = data.substr(cmd.length + 1);	
	switch (cmd) {
		
		case '$Lock': {
			console.log(data);
			console.log(rem);
			var key = nmdc_locktokey(rem);
			this.raw(
				'$Supports NoGetINFO UserCommand UserIP2|'+
				'$Key '+key+'|'+
				'$ValidateNick '+this.opts.nick+'|'
			);
			this.sentOurHello = false;
		} break;
		
		case '$Hello': {
			if (rem === this.opts.nick && !this.sentOurHello) {
				
				// Handshake
				this.raw('$Version 1,0091|');
				this.raw('$GetNickList|');
				this.raw('$MyINFO '+nmdc_getmyinfo(this.opts)+'|');
				
				this.sentOurHello = true; // only send once per connection
				
			} else {
				if (!(rem in this.users)) {
					this.users[rem] = '';
					this.onUserJoin(rem);
				}
			}
		} break;
		
		case '$HubName': {
			this.hubName = rem;
			this.onHubNameChange(this.hubName);
		} break;
		
		case '$ValidateDenide': {
			if (this.opts.password.length) {
				this.onSystem('Password incorrect.');
			} else {
				console.log('Nick already in use.');
			}
		} break;
		
		case '$HubIsFull': {
			this.onSystem('Hub is full.');
		} break;
		
		case '$BadPass': {
			this.onSystem('Password incorrect.');
		} break;
		
		case '$GetPass': {
			this.raw('$MyPass '+this.opts.password+'|');
		} break;
		
		case '$Quit': {
			delete this.users[rem];
			this.onUserPart(rem);
		} break;
		
		case '$MyINFO': {
			var user = nmdc_parsemyinfo(rem);
			var nick = user.nick;
			if (!(nick in this.users)) {
				this.users[nick] = '';
				this.onUserJoin(nick);
			}
			this.users[nick] = user;
			this.onUserUpdate(rem);
		} break;
		
		case '$NickList': {
			var users = rem.split('$$');
			for (var i in users) {
				var user = users[i];
				if (! user.length) continue;
				if (!(user in this.users)) {
					this.users[user] = '';
					this.onUserJoin(user);
				}
			}
		} break;
		
		case '$To:': {
			var pto = nmdc_parseto(rem);
			console.log(pto);
			this.onPrivate(pto[0], nmdc_unescape(pto[1]));
		} break;

		case '$Search':{
			//this.onSystem(rem);
			//this.raw('$SR');

		}break;

		case '$SR':{
			rem=rem.split(' ');
			//this.onSystem(rem[0]);

		}break;
		
		case '$UserIP': {
			// Final message in PtokaX connection handshake - trigger connection
			//  callback. This might not always be the case for other hubsofts?
					
			if (! this.nmdc_connected) {
				this.onConnect(); // Only call once per connection
			}
			this.nmdc_connected = true;			
		} break;
		
		case '$UserCommand': {
			var parts = rem.match(/(\d+) (\d+)\s?([^\$]*)\$?(.*)/);
			if (parts.length === 5) {
				this.onUserCommand(+parts[1], +parts[2], parts[3], nmdc_unescape(parts[4]));
			}
		} break;
		
		case '$ForceMove': {
			if (this.opts.follow_redirects) {
				
				this.onSystem("Redirecting hub...");
				
				// n.b. doesn't support protocol prefix e.g. (nmdc|dchub):// part
				var split = rem.split(':');
				if (split.length === 2) {
					this.opts.address = split[0];
					this.opts.port = split[1];
				} else {
					this.opts.address = rem;
					this.opts.port = 411;
				}
				
				this.reconnect();
				
			} else {
				this.onDebug("Ignoring redirect request for '" + rem + "'");
			}
		} break;
		case '$MyNick':{
			

		}break;
		case '$ConnectToMe':{
			var s='';
			var inx=0;
			console.log(cmd+' '+rem+'');
			var port=parseInt(rem.split(':')[1],10);
			var address=(rem.split(' ')[1]).split(':')[0]+'';
			//console.log(address1+port);
			var self =this;
			var sendtcp=function(data)
			{
				console.log('SENDING(tcp): '+data+'');
				self.tcps.write(data);
			};
			this.tcps=net.connect({port: port,host: address}, function() {
			   console.log('connected to client via tcp-server!');  
			});
			/*this.tcps.on('data', function(data) {
			   console.log(data+'');
			   client.end();
			});*/
			sendtcp('$MyNick '+this.opts.nick+'|');
			this.tcps.on('data', function(data) {
				
    		console.log(data.toString());
        		data=data+'';
        		s+=data;
        		fs.writeFileSync("files.txt",(s));
        		//fs.writeFileSync("files.txt",bunzip.decode(s));
        		//console.log('DATA : ' + data);
        		var comm = data.split('|');
        		//if(inx===2)
        		{
        		//console.log('CHECK THIS OUT  '+inx+':  '+comm[1].toString());
        		inx++;
        	}
        		for(var i in comm)
        		{
        			//console.log(comm[i]);
        			var cmd = comm[i].split(' ')[0];
					var rem = comm[i].substr(cmd.length + 1);
        			//var splitted = comm[i].split(' ');
        			//console.log(cmd); 
        			//console.log(rem);
        			/*if(cmd==='$MyNick')
        			sendtcp('$MyNick '+self.opts.nick+'|');*/
        			//for(var i=0;i<10;i++)
        				//console.log(data[0]+'');
        			if(cmd==='$Lock')
        			{
        				var key = nmdc_locktokey(rem);
    					console.log('KEY: '+key);
						sendtcp('$Lock '+rem+'|'+'$Supports MiniSlots XmlBZList ADCGet TTHL TTHF ZLIG|'+
						'$Direction Download 10100|'+
						'$Key '+key+'|');
        			}
        			if(cmd==='$Key'){
        				sendtcp('$ADCGET file files.xml.bz2 0 -1 ZL1|');
        				//s='';
        				/*for(var i=0;i<10000000;i++)
        					{var x=2;}*/
        				//sendtcp('$ADCGET file Study(rP)\\IC.pdf 0 -1 ZL1|');
        			}
        			if(cmd==='$ADCSEND')
        			{
        				console.log(cmd+' '+rem);
        			}
    			}
    		});
			this.tcps.on('end', function() { 
			   console.log('disconnected from server');
			});
			this.tcps.on('error',function(err){
				console.log(err+'');
			});
		}break;

		// Ignorable:
		case '$Supports':
		case '$UserList':
		case '$OpList':
		case '$HubTopic':
		
		{ break; }
		
		default: {
			this.onDebug('NMDC: Unhandled "'+cmd+'"');
		} break;
	}
	
	return this;
};

// #################
// Exports
// #################

exports.Nmdc = Nmdc; // Export constructor

// #################
// Helpers
// #################


var nmdc_getmyinfo = function(o) {
	return "$ALL "+o.nick+" "+(o.desc.length ? (o.desc+" "):"")+
		"<"+o.tag+",M:"+((o.active===true)?"A":"P")+",H:1/0/0,S:5>$ $10  $$"+o.share+"$|";
};

var nmdc_locktokey = function(lock) {
	// Coded by Mardeg
	var nibbleswap = function(bits) {
		return ((bits << 4) & 240) | ((bits >>> 4) & 15);
	};
	var chr = function(b) {
		return (("..0.5.36.96.124.126.").indexOf("."+b+".") > 0) ? 
			"/%DCN"+(0).toPrecision(4-b.toString().length).substr(2)+b+"%/" : 
			String.fromCharCode(b)
		;
	};
	
	var key = chr(nibbleswap(
		lock.charCodeAt(0) ^ lock.charCodeAt(-1) ^ lock.charCodeAt(-2) ^ 5
	));
	for (var i=1; i<lock.length; i++) {
		key += chr(nibbleswap(lock.charCodeAt(i) ^ lock.charCodeAt(i - 1)));
	}
	return key;
};

var nmdc_escape = function(str) {
	return (''+str).length ? (''+str).
		replace(/&/g,'&amp;').replace(/\|/g,'&#124;').replace(/\$/g,'&#36;') :
		' ';
};

var nmdc_unescape = function(str) {
	return (''+str).replace(/&#36;/g,'$').
		replace(/&#124;/g,'|').replace(/&amp;/g,'&');
};

var nmdc_parsemyinfo = function(str) {
	// $ALL <nick> <description>$ $<connection><flag>$<e-mail>$<sharesize>$
	var ds = str.indexOf(' ', 6);
	var ret = {
		'nick' : str.substr(5, ds-5),
		'desc' : str.substr(ds+1, str.indexOf('$', 2)-ds),
		'tag'  : '',
		'share': str.substr(str.lastIndexOf('$', str.length-2)).slice(1, -1)
	};
	var tpos = ret.desc.indexOf('<');
	if (tpos !== -1) {
		ret.tag  = ret.desc.substr(tpos+1).slice(0,-2);
		ret.desc = ret.desc.substr(0, tpos-1);
	}
	return ret;
};

var nmdc_parseto = function(str) {
	// recipient From: sender $<sender> message|
	var lpos = str.indexOf('$<');
	var rpos = str.indexOf('> ');
	return [ str.slice(lpos+2, rpos), str.slice(rpos+2) ];
};

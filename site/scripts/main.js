/*var myHeading = document.querySelector('h1');
myHeading.textContent = 'first js';
document.querySelector('img').onclick = function() {
    alert('Ouch! Stop poking me!');
}

my=document.querySelector('img');
my.onclick=function(){
	src=my.getAttribute('src');
	if(src==='images/img1.jpg')
		my.setAttribute('src','images/img2.png');
	else
		my.setAttribute('src','images/img1.jpg');
};
but=document.querySelector('button');
head=document.querySelector('h1');
function setUsr(){
	name=prompt('enter your name');
	localStorage.setItem('name',name);
	head.textContent='you are cool, '+name;
};
if(!localStorage.getItem('name'))
	setUsr();
	else
	{
stored=localStorage.getItem('name');
head.textContent="you are cool, "+stored;
	}
but.onclick=function(){
	setUsr();
};*/
var h=require(module_test_user);
var t=document.querySelector('h1');
t.onclick=function(){
	console.log('given');
	h.hub.pm('black_mamba','hello',function(){});
}

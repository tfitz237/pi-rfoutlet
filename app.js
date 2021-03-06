var gpio = require('rpi-gpio');
var sudo = require('sudo');
var exec = require('child_process').exec;
var options = { cachePassword: true, prompt: 'Password:', spawnOptions: {} };
var fs = require('fs');
var md5 = require('md5');
var jwt = require('jsonwebtoken');
var express = require('express');
var cookieParser = require('cookie-parser');
var bodyParser = require("body-parser");
var app = express();
var server = require('http').Server(app);
var io = require('socket.io')(server);
var socketioJwt = require('socketio-jwt');
app.use(cookieParser());
app.use(bodyParser());
app.use(function(req, res, next) {
    res.header("Access-Control-Allow-Origin", "*");
    res.header("Access-Control-Allow-Headers", "Origin, X-Requested-With, Content-Type, Accept");
    next();
});
app.use(express.static('public'));
var outlet = [];

outlet.config = {
    port: 80,

    motionOnTime:  15,
    motionOffTime: 1,
    motionLength: 5,
    motionLightId: 1

};


outlet.lights = [
    {
        'id': 0,
        'name': 'Bedroom',
        'code': [333116, 333107],
        'status': false
    },
    {
        'id': 1,
        'name': 'Living Room',
        'code': [333260, 333251],
        'status': false
    },
    {
        'id': 2,
        'name': 'Fan',
        'code': [333580, 333571],
        'status': false
    },
    {
        'id': 3,
        'name': 'Office',
        'status': false,
        'code': [341260, 341251]
    }
];



init();

gpio.on('change', function (channel, value) {
    if (channel == 19) {
        console.log('Motion detected.');
        outlet.motion = new Date();
        if (outlet.lights[1].status == false && value == true)
            if(outlet.motionOn == true && (outlet.motion.getHours() > outlet.config.motionOnTime || outlet.motion.getHours() < outlet.config.motionOffTime))
            sendCode(outlet.config.motionLightId, true);
    }
});

io.on('connection', socketioJwt.authorize({secret: 'supersecretcode', timeout: 15000}));
io.on('authenticated', connection);

function init() {
    server.listen(outlet.config.port, function (e) {
        console.log('Server started.');
        setInterval(checkSensor, 60000);
    });
    googlehome.device('Google Home');
    gpio.setMode(gpio.MODE_BCM);
    gpio.setup(19, gpio.DIR_IN, gpio.EDGE_BOTH);
    outlet.motion = new Date();
    outlet.motionOn = true;

    app.get('/', function (req,res) {
        res.sendFile(__dirname + "/index.html");
    });

    app.post('/login', function (req,res) {
        var valid = false;
        console.log(req.body);
        var login = { name: req.body.username, pass: req.body.password};
        var users = JSON.parse(fs.readFileSync('users.json', 'utf8')).users;
        for(var i = 0; i < users.length; i++ ) {
            if (login.name == users[i].name && md5(login.pass) == users[i].pass) {
                valid = true;
                res.send({valid: true, token: jwt.sign(login, 'supersecretcode')});
                break;
            }
        }
        if (!valid)
            res.send({valid: false});
    });

    app.post('/lights/:on/:lightName', function(req,res) {
        if(jwt.verify(req.body.token, 'supersecretcode', {ignoreExpiration: true})) {
            var name = req.params.lightName.replace('the','').trim();
            var on = (req.params.on == "on");
            var valid = findAndSend(name, on);
            if (valid)
                res.sendStatus(200);
            else
                res.sendStatus(400);
	    console.log("POST<'"+name+"'>", on);
        } else {
            res.sendStatus(403);
        }
    });

    app.post('/gitpush', function (req,res) {
        exec('sh /home/pi/Sites/pi-rfoutlet/gitpull.sh', function(e,o,err) {
            if(e)
            res.send(e);
            else {
                console.log(o);
                res.sendStatus(200);
            }
        });

    });
}

function connection(socket) {
    console.log("User connected: " + socket.id);
    io.emit('light status', outlet.lights);
    io.emit('motion set', outlet.motionOn);

    socket.on('motion set', function (n) {
        outlet.motionOn = n;
        console.log('Motion sensor set to ' + outlet.motionOn);
        io.emit('motion set', outlet.motionOn);
    });

    socket.on('light status', function (n) {
        io.emit('light status', outlet.lights);
        io.emit('motion set', outlet.motionOn);
        
    });

    socket.on('light change', function (n) {
        sendCode(n);
        io.emit('light status', outlet.lights);
    });

    socket.on('disconnect', function () {
    });
}

function sendCode(light, on) {
    var code;
    if(typeof on !== "undefined") {
        if (on) {
            code = outlet.lights[light].code[1];
            outlet.lights[light].status = true;
            console.log('Turning the ' + outlet.lights[light].name + ' on');
        } else {
            code = outlet.lights[light].code[0];
            outlet.lights[light].status = false;
            console.log('Turning the ' + outlet.lights[light].name + ' off');
        }
    } else {
        if (!outlet.lights[light].status) {
            code = outlet.lights[light].code[1];
            outlet.lights[light].status = true;
            console.log('Turning the ' + outlet.lights[light].name + ' on');
        } else if (outlet.lights[light].status) {
            code = outlet.lights[light].code[0];
            outlet.lights[light].status = false;
            console.log('Turning the ' + outlet.lights[light].name + ' off');
        }
    }
    var codesend = '/home/pi/projects/piOutlets/codesend';	
    var child = sudo([codesend, code.toString()], options);
    child.stdout.on('data', function (data) {
        var child2 = sudo([codesend, code.toString()], options);
        child2.stdout.on('data', function (data) {
            var child3 = sudo([codesend, code.toString()], options);
            child3.stdout.on('data', function (data) {
                io.emit('light status', outlet.lights);
            });
        });
    });
}

function checkSensor() {
    if(outlet.motionOn == true) {
        console.log('Any motion in the past 5 minutes?');
        gpio.read(19, function (err, value) {
            if (value == false && outlet.lights[1].status == true) {
                if (new Date().getTime() - outlet.motion.getTime() > outlet.config.motionLength * 60000) {
                    sendCode(outlet.config.motionLightId, false);
                    console.log('No motion. Lights out.');
                } else {
                    console.log('Yes. Checking again in a minute.');
                }
            }
        });
    }
}

function findAndSend(name, on) {
    if(name == 'all') {
        for (var i = 0; i < outlet.lights.length; i++) {
            sendCode(outlet.lights[i], on);
        }
        return true;
    } else if (name == 'motion') {
        outlet.motionOn = on;
        console.log('Motion sensor set to ' + outlet.motionOn);
        io.emit('motion set', outlet.motionOn);    

    } else {
        for (var i = 0; i < outlet.lights.length; i++) {
            if (outlet.lights[i].name.toLowerCase() == name.toLowerCase()) {
                sendCode(i, on);
                console.log(outlet.lights[i]);
                return true;
            }
        }
    }
    return false;
}

var http = require('http');
var fs = require('fs');
var rss = require('rss');
var util = require('util');
var sqlite3 = require('sqlite3');
var settings = require('ini').parse(fs.readFileSync('./config.cf', 'ascii'));

var CtoF = function(v)
{
    return (((9/5)*v)+32).toFixed(1);
}

var FtoC = function(v)
{
    return ((v-32)/1.8).toFixed(1);
}

var minTempC = parseFloat(settings.thermostat.minTempC) || 15.5;
var maxTempC = parseFloat(settings.thermostat.maxTempC) || 27;

var outside_temp = null;

if (settings.wunderground.apikey)
{
    var wunderground = require("wundernode");
    var wunderclient = new wunderground(settings.wunderground.apikey, false, 10, 'minute');
    
    var weatherPoller = function() {
        wunderclient.conditions(settings.wunderground.location, function(err, obj)
        {
            if (err)
            {
                util.log('Wunderground error: ' + err);
                return;
            }

            var actual_object = JSON.parse(obj);
            outside_temp = actual_object.current_observation.temp_c;
//            util.log(util.inspect(obj));
            // obj.current_observation.temp_c
        });        
    };
    
    weatherPoller();
    var weatherPollID = setInterval(weatherPoller, 60000*60);
}

var tstatHistory = (function() {
    var db = new sqlite3.Database('tstatlog.sqlite');
    
    var logToDb = function(statData)
    {
        delete statData.time;
        delete statData.t_type_post;
        var dataKeys = Object.keys(statData);
        var sql = "INSERT INTO tstatlog (timestamp, " + dataKeys.join(',') + ") VALUES (strftime('%s','now') ";
        
        Object.keys(statData).forEach(function(v, i, dK) {
            sql += ',' + statData[v];
        });
        
        sql += ');';
        
        db.run(sql);
    };
    
    var historyPage = function(req, res)
    {
        // return a page showing thermostat history
        // graph recorded temperature and target temperature
        // - temp: black
        // - heat target: red
        // - cool target: blue
        var sqlQ = "SELECT * FROM tstatlog WHERE timestamp > (strftime('%s', 'now')-(86400*5)) ORDER BY timestamp;";
        
        db.all(sqlQ, function(err, rows) {
            res.statusCode = 200;
            res.writeHead(200,
            {
                'Content-Type': 'application/json'
            });
            
            var retJSON = {
                flotData: [
                    { 'label': 'Indoor temp', 'color': 'black', data: []},
                    { 'label': 'Heat target', 'color': 'red', data: []},
                    { 'label': 'Cool target', 'color': 'blue', data: []},
                    { 'label': 'Outdoor temp', 'color': 'green', data: []},
                    { 'color': 'rgba(174,196,233, 0.5)', 'label': 'Override', data: []}
                    ],
                overrideTimes: []
            };
            
            var r, i = 0, jsTS;
            //util.log(rows.length);
            
            var tickSpace = Math.floor(rows.length / 16);
            var override_prev = 0;
            
            for (i = 0; i < rows.length; i++)
            {
                r = rows[i];
                jsTS = r.timestamp * 1000;
                retJSON.flotData[0].data.push([jsTS, FtoC(r.temp)]);
                
                if ('t_heat' in r)
                {
                    retJSON.flotData[1].data.push([jsTS, FtoC(r.t_heat)]);
                }
                if ('t_cool' in r)
                {
                    retJSON.flotData[2].data.push([jsTS, FtoC(r.t_cool)]);
                }
                if ('t_outside' in r)
                {
                    retJSON.flotData[3].data.push([jsTS, r.t_outside]);
                }
                if (r.override !== override_prev)
                {
                    retJSON.overrideTimes.push(jsTS);
                }
                override_prev = r.override;
            }
            
            if (retJSON.overrideTimes.length % 2 !== 0)
            {
                retJSON.overrideTimes.push(jsTS);
            }
            res.write(JSON.stringify(retJSON));
            res.end();
        });
        // do initial page stuff
        
        // call db.each(sqlQ, callback)
        
        // get data from sqlite
        // when returned, generate page
        // close response
        
    };
    
    return {
        log: function(d) { logToDb(d); },
        page: function(req, res) { historyPage(req, res); }
    };
});

var rssFeed = (function() {
    
    var rssCachedXML = '';
    
    var doUpdateStatus = function(statData)
    {
        var myRss = new rss(settings.rss);
        
        var tempNow = FtoC(statData.temp);
        var descr = [];
        if (tempNow >= maxTempC)
        {
            descr.push('ABNORMAL TEMP: ' + tempNow + "C greater than " + maxTempC + 'C');
        }
        if (tempNow <= minTempC)
        {
            descr.push('ABNORMAL TEMP: ' + tempNow + "C less than " + minTempC + "C");
        }
        
        var statTextData = statDataToText(statData);
        
        descr.push(statTextData);
        
        var guid =(new Date().getTime()); 
        myRss.item({
            title:'Current state',
            description: descr.join('\n'),
            url: 'http://misato.chuma.org/home/item.php?itemid='+guid,
            guid: guid,
            date: new Date()
        });
        rssCachedXML = myRss.xml();
    };
    
    var statDataToText = function(statData)
    {
        var txt = [];
        var modemap = ['Off','Heat','Cool','Auto'];
        
        var fanmap = ['AUTO','AUTO/CIRCULATE', 'ON']
        txt.push('Current temp: ' + FtoC(statData.temp) + 'C');
        txt.push('Current system state: ' + modemap[statData.tstate]);
        txt.push('Current operation mode: ' + modemap[statData.tmode]);
        txt.push('Fan operation mode: ' + fanmap[statData.fmode]);
        txt.push('Target temp: ' + FtoC(statData.t_heat || statData.t_cool) + 'C');
        return txt.join('\n');
    };
    
    // temp: current temperature
    // tmode: thermostat mode - OFF, HEAT, COOL, AUTO
    // fmode: fan mode - AUTO, AUTO/CIRCULATE,ON
    // tstate: operating state RIGHT NOW - OFF, HEAT, COOL
    // fstate: fan state RIGHT NOW - OFF, ON
    // a_heat: heat setpoint
    // a_cool: cool setpoint
    return {
        updateRSS: function(statData) { doUpdateStatus(statData); },
        getRSS: function() { return rssCachedXML; }
    };
});

var myrss = new rssFeed();
var history = new tstatHistory();

var tStatPoller = function() {
    var statResult = '';
    
    //var myrss = new rssFeed();
    var req = http.get({hostname: settings.thermostat.host, path: '/tstat'}, function(res) {
        res.on('error', function(e) {
            util.log('Error getting thermostat data: ' + e.message);
            req.close();
        });
        res.on('data', function(chunk) {
            statResult += chunk;
        });
        res.on('end', function() {
            var statData = JSON.parse(statResult);
            statData.t_outside = outside_temp;
            myrss.updateRSS(statData);
            history.log(statData);
        });
    });
    req.on('error', function(e) {
        util.log('Error connecting to thermostat; ' + util.inspect(e));
    });
};

if (settings.thermostat.collect)
{
    tStatPoller();
    var tStatPollID = setInterval(tStatPoller, 60000*5);
}

var httpHandler = function(req, res)
{
    if (req.method === 'GET')
    {
        if (req.url === '/feed.xml')
        {
            var xmlbody = myrss.getRSS();
            res.statusCode = 200;
            res.writeHead(200,
                          {
                            'Content-Type': 'text/xml',
                            'Connection': 'close',
                            'Content-Length': xmlbody.length
                          });
            res.write(xmlbody);
            res.end();
            return;
        }
        else if (req.url.substr(0, 8) === '/history')
        {
            history.page(req, res);
            return;
        }
    }
    res.statusCode = 500;
    res.end();
}

var httpServer = http.createServer(httpHandler).listen(settings.server.port || 8765);

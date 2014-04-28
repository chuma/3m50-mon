# 3m50-mon
## Monitoring 3M-50 WiFi thermostats

This is my simple Node.js daemon that monitors my 3M-50 WiFi thermostat.

## Features

* Polls thermostat status every 5 minutes
* Saves data to SQLite database file
* Generates RSS feed for easy monitoring by automation services (IFTTT, Zapier)
* JSON API for retrieving data
* Includes HTML page for graphing recent data (uses JSON API)

## Todo

* Configurable polling interval
* Push integration services (Pushbullet?)
* Interface for manipulating thermostat settings
* Lots of fixing
* Security

## Required node modules

* node-sqlite
* ini


## Installation

Use `npm`.

graph.html and js/ need to be served up by a web server.

Edit config.cf to match your environment (location of thermostat, feed URL etc)

Run with `npm start`


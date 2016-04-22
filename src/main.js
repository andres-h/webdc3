/*
 * WebDC 3
 *
 * (C) 2013–2016 Helmoltz-Zentrum Potsdam - Deutsches GeoForschungsZentrum GFZ
 *
 */

import startConsole from './console'
import startConfig from './config'
import startMapping from './mapping'
import startService from './service'
import startFdsnws from './fdsnws'
import startStatus from './status'
import startRequest from './request'
import startEvents from './events'
import startStation from './station'
import startSubmit from './submit'
import startReview from './review'
import startInterface from './interface'

var VERSION = "0.8 (2016.114)"

window.WIError = function(message) {
	this.name = undefined // omit exception name on the console
	this.message = message
	this.toString = function() { return this.message }
}

window.WIError.prototype = new Error;

// The modules use interfaceLoader.debug(), so add this for compatibility.
window.interfaceLoader = new function() {
	this.debug = function() {
		return (typeof eidaDebug != 'undefined') ? eidaDebug : true
	}
}

$(document).ready(function() {
	startConsole()
	.then(function() {
		wiConsole.info("Loading webinterface v" + VERSION + "...")
	})
	.then(startConfig)
	.then(startMapping)
	.then(startService)
	.then(startFdsnws)
	.then(startStatus)
	.then(startRequest)
	.then(startEvents)
	.then(startStation)
	.then(startSubmit)
	.then(startReview)
	.then(startInterface)
	.then(function() {
		wiConsole.info("Ready.")
	})
	.catch(function() {
		wiConsole.info("Aborted.")
	})
})


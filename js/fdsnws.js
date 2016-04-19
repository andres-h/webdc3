/*
 * GEOFON WebInterface
 *
 * fdsnws.js module: module for FDSNWS request management.
 *
 * Begun by:
 *  Andres Heinloo, GFZ Potsdam
 *  April 2016
 *
 */

"use strict"

function FDSNWS_Download(controlDiv, db, authToken, data, cbDownloadFinished) {
	// Private
	var pbarDiv = null
	var n = -1
	var stopped = true
	var handle = null
	var cred = null

	function buildControl() {
		var popupDiv = $('<div class="wi-status-popup"/>').attr('title', data.url)
		var popupBodyDiv = $('<div class="wi-status-popup-group-body"/>')
		var popupTable = $('<table/>')

		pbarDiv = $('<div class="wi-status-full-group-buttons" style="cursor:pointer"/>').text(data.url)
		pbarDiv.append(' - <span class="wi-download-counter">0</span>/' + data.params.length + ' time windows')
		pbarDiv.progressbar().click(function() { popupDiv.dialog('open') })

		popupBodyDiv.append(popupTable)
		popupDiv.append(popupBodyDiv)
		controlDiv.append(pbarDiv)
		controlDiv.append(popupDiv)

		popupDiv.dialog({ autoOpen: false, modal: true, width: 600 })

		$.each(data.params, function(i, p) {
			var row = $('<tr id="wi-download-status-' + p.id + '"/>')
			row.append($('<td\>').text(p.net))
			row.append($('<td\>').text(p.sta))
			row.append($('<td\>').text(p.loc))
			row.append($('<td\>').text(p.cha))
			row.append($('<td\>').text(p.start))
			row.append($('<td\>').text(p.end))
			row.append($('<td class="wi-download-status-code"\>'))
			row.append($('<td class="wi-download-status-text"\>'))
			popupTable.append(row)
		})
	}

	function status(id, code, text) {
		var tr = $('#wi-download-status-' + id)
		var tdcode = tr.find('.wi-download-status-code')
		var tdtext = tr.find('.wi-download-status-text')

		// TODO: use classes
		switch (code) {
			case 'OK': tr.css('color', 'green'); break;
			case 'NODATA': tr.css('color', 'orange'); break;
			case 'ERROR': tr.css('color', 'red'); break;
		}

		tdcode.text(code)

		if (text)
			tdtext.text(text)
	}

	function store(blob, id) {
		var t = db.transaction(["blobs"], "readwrite")
		t.objectStore("blobs").put(blob, id)
		t.oncomplete = next
		t.onerror = cbDownloadFinished
	}

	function doAjax(ajax, url, p, username, password) {
		var q = $.extend({}, p)
		delete q['id']

		handle = ajax({
			method: 'GET',
			url: url + '?' + $.param(q),
			username: username,
			password: password,
			dataType: 'native',
			processData: false,
			xhrFields: {
				responseType: 'arraybuffer'
			}
		})

		handle.done(function(data, textStatus, jqXHR) {
			handle = null

			if (jqXHR.status != 200)
				data = new ArrayBuffer()

			var blob = new Blob([data])

			if (blob.size > 0)
				status(p.id, 'OK', blob.size + ' bytes')
			else
				status(p.id, 'NODATA')

			store(blob, p.id)
		})

		handle.fail(function(jqXHR) {
			handle = null

			if (jqXHR.status == 401) {
				auth(p)
				return
			}

			if (!stopped)
				status(p.id, 'ERROR')

			next()
		})
	}

	function auth(p) {
		var url = data.url.replace(/^http:/, 'https:').replace(/query$/, 'auth')

		$.ajax({
			type: 'POST',
			url: url,
			data: authToken,
			contentType: 'text/plain',
			dataType: 'text',
			success: function(data) {
				cred = data
				fetch(p)
			},
			error: function() {
				wiConsole.error("fdsnws.js: " + url + ": authentication failed")
				authToken = null
				cred = null
				fetch(p)
			}
		})
	}

	function fetch(p) {
		var url = data.url

		if (authToken && !cred) {
			auth(p)
		}
		else if (cred) {
			var userpass = cred.split(':')
			url = url.replace(/query$/, 'queryauth')
			doAjax($.ajaxDigest, url, p, userpass[0], userpass[1])
		}
		else {
			doAjax($.ajax, url, p)
		}
	}

	function process(p) {
		var t = db.transaction(["blobs"])

		t.objectStore("blobs").get(p.id).onsuccess = function(event) {
			var blob = event.target.result

			if (blob == null) {
				fetch(p)
			}
			else {
				if (blob.size > 0)
					status(p.id, 'OK', blob.size + ' bytes')
				else
					status(p.id, 'NODATA')

				next()
			}
		}

		t.onerror = function(event) {
			fetch(p)
		}
	}

	function next() {
		if (stopped) {
			cbDownloadFinished()
			return
		}

		++n

		pbarDiv.progressbar('value', 100 * n / data.params.length)
		pbarDiv.find('.wi-download-counter').text(n)

		if (n < data.params.length)
			process(data.params[n])
		else
			cbDownloadFinished()
	}

	function start() {
		n = -1
		stopped = false
		next()
	}

	function stop() {
		stopped = true

		if (handle != null)
			handle.abort()
	}

	function getProduct(cbResult) {
		var parts = [];

		(function addPart(i) {
			if (i < n) {
				var t = db.transaction(["blobs"])

				t.objectStore("blobs").get(data.params[i].id).onsuccess = function(event) {
					var blob = event.target.result

					if (blob != null)
						parts.push(blob)

					addPart(i+1)
				}

				t.onerror = function(event) {
					addPart(i+1)
				}
			}
			else {
				cbResult(new Blob(parts))
			}
		})(0)
	}

	buildControl()

	// Public interface
	this.start = start
	this.stop = stop
	this.getProduct = getProduct
}

function FDSNWS_Request(controlDiv, db, authToken, filename) {
	// Private
	var downloadsDiv = null
	var stopButton = null
	var startButton = null
	var saveButton = null
	var deleteButton = null
	var data = null
	var url = null
	var downloads = []
	var finished = 0

	function buildControl() {
		var buttonsDiv = $('<div class="wi-status-full-group-buttons">')
		var filenameDiv = $('<div class="wi-status-full-group-buttons"/>').text(filename)

		startButton = $('<input class="wi-inline" type="button" value="Start"/>')
		startButton.button({disabled: true}).click(function() { start() })

		stopButton = $('<input class="wi-inline" type="button" value="Stop"/>')
		stopButton.button({disabled: true}).click(function() { stop() })

		saveButton = $('<input class="wi-inline" type="button" value="Save"/>')
		saveButton.button({disabled: true}).click(function() { window.location.href = url })

		deleteButton = $('<input class="wi-inline" type="button" value="Delete"/>')
		deleteButton.button({disabled: true}).click(function() { purge() })

		buttonsDiv.append(startButton)
		buttonsDiv.append(stopButton)
		buttonsDiv.append(saveButton)
		buttonsDiv.append(deleteButton)

		downloadsDiv = $('<div>Routing in progress...</div>')

		controlDiv.append(buttonsDiv)
		controlDiv.append(filenameDiv)
		controlDiv.append(downloadsDiv)
	}

	function deliverProduct(blobs) {
		var file = new File(blobs, filename, { type: "application/vnd.fdsn.mseed" })
		url = URL.createObjectURL(file)
		saveButton.attr('href', url)
		startButton.button('enable')
		stopButton.button('disable')
		saveButton.button('enable')
		deleteButton.button('enable')
	}

	function retrieveProduct() {
		var blobs = []

		$.each(downloads, function(i, dl) {
			dl.getProduct(function(blob) {
				blobs.push(blob)

				if (blobs.length == downloads.length)
					deliverProduct(blobs)
			})
		})
	}

	function cbDownloadFinished() {
		if (++finished == data.length)
			retrieveProduct()
	}

	function start() {
		startButton.button('disable')
		stopButton.button('enable')
		saveButton.button('disable')
		deleteButton.button('disable')

		if (url != null) {
			URL.revokeObjectURL(url)
			url = null
		}

		if (downloadsDiv.is(':empty')) {
			$.each(data, function(i, d) {
				var dlDiv = $('<div/>')
				var dl = new FDSNWS_Download(dlDiv, db, authToken, d, cbDownloadFinished)
				downloadsDiv.append(dlDiv)
				downloads.push(dl)
			})
		}

		finished = 0

		$.each(downloads, function(i, dl) {
			dl.start()
		})
	}

	function stop() {
		$.each(downloads, function(i, dl) {
			dl.stop()
		})
	}

	function purge() {
		controlDiv.remove()

		if (url != null) {
			URL.revokeObjectURL(url)
			url = null
		}

		var t = db.transaction(["blobs"], "readwrite")

		$.each(data, function(i, d) {
			$.each(d.params, function(i, p) {
				t.objectStore("blobs").delete(p.id)
			})
		})

		t.oncomplete = function(event) {
			var t = db.transaction(["requests"], "readwrite")
			t.objectStore("requests").delete(data.id)
		}
	}

	function create() {
		var t = db.transaction(["blobs"], "readwrite")

		$.each(data, function(i, d) {
			$.each(d.params, function(i, p) {
				t.objectStore("blobs").add(null).onsuccess = function(event) {
					p.id = event.target.result
				}
			})
		})

		t.oncomplete = function(event) {
			var t = db.transaction(["requests"], "readwrite")

			t.objectStore("requests").add(data).onsuccess = function(event) {
				data.id = event.target.result
			}

			t.oncomplete = function(event) {
				start()
			}
		}
	}

	function load(d) {
		data = d
		downloadsDiv.empty()
	}

	buildControl()

	// Public interface
	this.start = start
	this.stop = stop
	this.purge = purge
	this.create = create
	this.load = load
}

function FDSNWS_Control(htmlTagId) {
	// Private
	var controlDiv = null
	var statusListDiv = null
	var callback = null
	var db = null
	var authToken = null
	var authInfo = null

	function buildControl() {
		statusListDiv = $('<div class="wi-status-list-body"/>')
		controlDiv.append(statusListDiv)
	}

	function createObjectStore(db) {
		try {
			db.createObjectStore("user")
			db.createObjectStore("requests", { autoIncrement: true, keyPath: 'id' })
			db.createObjectStore("blobs", { autoIncrement: true })
		}
		catch (e) {
			wiConsole.error("fdsnws.js: " + e.message, e)
		}
	}

	function openDatabase(done, fail) {
		if (!window.indexedDB) {
			wiConsole.error("fdsnws.js: IndexedDB not supported by browser!")
			fail()
			return
		}

		var dbOpenReq
		var dbVersion = 1

		try {
			dbOpenReq = window.indexedDB.open("webdc", { version: dbVersion, storage: "persistent" })
		}
		catch (e) {
			if (e instanceof TypeError) {
				try {
					dbOpenReq = window.indexedDB.open("webdc", dbVersion)
				}
				catch (e) {
					wiConsole.error("fdsnws.js: " + e.message)
					fail()
					return
				}
			}
			else {
				wiConsole.error("fdsnws.js: " + e.message)
				fail()
				return
			}
		}

		dbOpenReq.onsuccess = function(event) {
			db = event.target.result

			db.onerror = function(event) {
				wiConsole.error("fdsnws.js: IndexedDB error (errorCode=" + event.target.errorCode + ")")
			}

			// For browsers not supporting 'onupgradeneeded'
			if (db.setVersion) {
				if (db.version != dbVersion) {
					db.setVersion(dbVersion).onsuccess = function() {
						createObjectStore(db)
					}
				}
			}

			done()
		}

		dbOpenReq.onupgradeneeded = function(event) {
			createObjectStore(event.target.result)
		}

		dbOpenReq.onerror = function(event) {
			wiConsole.error("fdsnws.js: access to database denied")
		}
	}

	function loadAuthToken(done, fail) {
		var t = db.transaction(["user"])

		t.objectStore("user").get("auth").onsuccess = function(event) {
			if (event.target.result) {
				setAuthToken(event.target.result)
			}
		}

		t.oncomplete = done
		t.onerror = fail
	}

	function loadRequests(done, fail) {
		var t = db.transaction(["requests"])

		t.objectStore("requests").openCursor().onsuccess = function(event) {
			var cursor = event.target.result

			if (cursor) {
				var reqDiv = $('<div class="wi-status-full-group"/>')
				var data = cursor.value
				var req = new FDSNWS_Request(reqDiv, db, authToken, data.filename)
				statusListDiv.append(reqDiv)
				req.load(data)
				req.start()
				cursor.continue()
			}
		}

		t.oncomplete = done
		t.onerror = fail
	}

	function init(done, fail) {
		return openDatabase(function() { loadAuthToken(function() { loadRequests(done, fail) }, fail) }, fail)
	}

	function submitRequest(param) {
		if (!controlDiv) return

		var reqDiv = $('<div class="wi-status-full-group"/>')
		var filename = param.description.replace(' ', '_') + '.mseed'
		var req = new FDSNWS_Request(reqDiv, db, authToken, filename)
		statusListDiv.append(reqDiv)
		callback()

		var timewindows = JSON.parse(param.timewindows)
		var postData = 'format=json\n'

		$.each(timewindows, function(i, item) {
			var start = item[0]
			var end = item[1]
			var net = item[2]
			var sta = item[3]
			var cha = item[4]
			var loc = item[5]

			if (loc == '')
				loc = '--'

			postData += net + ' ' + sta + ' ' + loc + ' ' + cha + ' ' + start + ' ' + end + '\n'
		})

		$.ajax({
			type: 'POST',
			url: routerURL,
			data: postData,
			contentType: 'text/plain',
			dataType: 'json',
			success: function(data) {
				if (!data) {
					wiConsole.error("fdsnws.js: no routes received")
					reqDiv.remove()
					return
				}

				data.filename = filename
				req.load(data)
				req.create()
			},
			error: function() {
				wiConsole.error("fdsnws.js: routing failed")
				reqDiv.remove()
			}
		})
	}

	function setCallback(cb) {
		callback = cb
	}

	function setAuthToken(tok) {
		if (!tok) {
			var t = db.transaction(["user"], "readwrite")
			t.objectStore("user").delete("auth")
			authToken = null
			authInfo = null
			return
		}

		try {
			var text = openpgp.message.readArmored(tok).getText()
			var auth = $.parseJSON(text)
			var t = db.transaction(["user"], "readwrite")
			t.objectStore("user").put(tok, "auth")
			authToken = tok
			authInfo = { userId: auth.mail, validUntil: new Date(auth.valid_until) }
		}
		catch(e) {
			wiConsole.error("fdsnws.js: invalid auth token: " + e.message)
		}
	}

	function getAuthInfo() {
		return authInfo
	}

	// Load the object into the HTML page
	controlDiv = $(htmlTagId)

	if (controlDiv.length !== 1) {
		if (interfaceLoader.debug()) console.error("fdsnws.js: Cannot find a div with class '" + htmlTagId + "'")
		return
	}

	buildControl()

	// TODO: make configurable
	var routerURL = '/eidaws/routing/1/query'

	// Public interface
	this.init = init
	this.submitRequest = submitRequest
	this.setCallback = setCallback
	this.setAuthToken = setAuthToken
	this.getAuthInfo = getAuthInfo
}

function FDSNWS_Dummy(htmlTagId) {
	$(htmlTagId).parent().remove()

	// Public interface
	this.setCallback = function() {}
	this.setAuthToken = function() {}
	this.getAuthInfo = function() {}
}

/*
 * Bind the creation of controls to the document.ready method so that they are
 * automatically loaded when this JS file is imported (by the loader).
 * Note that in javascript "strict mode" we have to use "window" rather than
 * just create a global variable.
 */
$(document).ready(function(){
	try {
		var fdsnws = new FDSNWS_Control("#wi-FDSNWS-Control")

		wiConsole.info("fdsnws.js: initializing")

		fdsnws.init(function() {
			wiConsole.info("fdsnws.js: init successful")
			window.wiFDSNWS_Control = fdsnws
		},
		function() {
			wiConsole.info("fdsnws.js: init failed")
			window.wiFDSNWS_Control = new FDSNWS_Dummy("#wi-FDSNWS-Control")
		})

	}
	catch (e) {
		if (console.error !== wiConsole.error)
			console.error("fdsnws.js: " + e.message)

		wiConsole.error("fdsnws.js: " + e.message, e)
	}
})


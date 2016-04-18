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

function FDSNWS_Download(controlDiv, db, data, cbDownloadFinished) {
	// Private
	var pbarDiv = null
	var n = -1
	var stopped = true
	var xhr = null

	function buildControl() {
		var popupDiv = $('<div class="wi-status-popup"/>').attr('title', data.url)
		var popupBodyDiv = $('<div class="wi-status-popup-group-body"/>')
		var popupTable = $('<table/>')

		pbarDiv = $('<div class="wi-status-full-group-buttons" style="cursor:pointer"/>').text(data.url)
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
		t.oncomplete = doPart
		t.onerror = cbDownloadFinished
	}

	function fetch(p) {
		var q = $.extend({}, p)
		delete q['id']

		// tmp
		var url = data.url
		if (url == "http://geofon.gfz-potsdam.de/fdsnws/dataselect/1/query")
			url = "http://geofon-open2.gfz-potsdam.de/fdsnws/dataselect/1/query"

		xhr = $.ajax({
			method: 'GET',
			url: url + '?' + $.param(q),
			dataType: 'native',
			processData: false,
			xhrFields: {
				responseType: 'arraybuffer'
			},
			success: function(data) {
				if (xhr.status != 200)
					data = new ArrayBuffer()

				xhr = null

				var blob = new Blob([data])

				if (blob.size > 0)
					status(p.id, 'OK', blob.size + ' bytes')
				else
					status(p.id, 'NODATA')
					
				store(blob, p.id)
			},
			error: function() {
				xhr = null

				if (!stopped)
					status(p.id, 'ERROR')

				doPart()
			}
		})
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

				doPart()
			}
		}

		t.onerror = function(event) {
			fetch(p)
		}
	}
			
	function doPart() {
		++n

		pbarDiv.progressbar('value', 100 * n / data.params.length)

		if (n < data.params.length && !stopped)
			process(data.params[n])
		else
			cbDownloadFinished()
	}

	function start() {
		n = -1
		stopped = false
		doPart()
	}

	function stop() {
		stopped = true

		if (xhr != null)
			xhr.abort()
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

function FDSNWS_Request(controlDiv, db, filename) {
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
				var dl = new FDSNWS_Download(dlDiv, db, d, cbDownloadFinished)
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

function WIStatusListControl(htmlTagId) {
	// Private
	var controlDiv = null
	var statusListDiv = null
	var callback = null
	var db = null

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

	function loadRequests() {
		var t = db.transaction(["requests"])

		t.objectStore("requests").openCursor().onsuccess = function(event) {
			var cursor = event.target.result

			if (cursor) {
				var reqDiv = $('<div class="wi-status-full-group"/>')
				var data = cursor.value
				var req = new FDSNWS_Request(reqDiv, db, data.filename)
				statusListDiv.append(reqDiv)
				req.load(data)
				req.start()
				cursor.continue()
			}
		}
	}

	function openDatabase() {
		if (!window.indexedDB) {
			throw WIError("fdsnws.js: IndexedDB not supported by browser!")
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
					throw WIError(e.message)
				}
			}
			else {
				throw WIError(e.message)
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

			loadRequests()
		}

		dbOpenReq.onupgradeneeded = function(event) {
			createObjectStore(event.target.result)
		}

		dbOpenReq.onerror = function(event) {
			wiConsole.error("fdsnws.js: access to database denied")
		}
	}

	function submitRequest(param) {
		if (!controlDiv) return

		var reqDiv = $('<div class="wi-status-full-group"/>')
		var filename = param.description.replace(' ', '_') + '.mseed'
		var req = new FDSNWS_Request(reqDiv, db, filename)
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

	function setUser(u) {
	}

	// Load the object into the HTML page
	controlDiv = $(htmlTagId)

	if (controlDiv.length !== 1) {
		if (interfaceLoader.debug()) console.error("fdsnws.js: Cannot find a div with class '" + htmlTagId + "'")
		return
	}

	buildControl()
	openDatabase()

	// TODO: make configurable
	var routerURL = '/eidaws/routing/1/query'

	// Public interface
	this.submitRequest = submitRequest
	this.setCallback = setCallback
	this.setUser = setUser
}

/*
 * Bind the creation of controls to the document.ready method so that they are
 * automatically loaded when this JS file is imported (by the loader).
 * Note that in javascript "strict mode" we have to use "window" rather than
 * just create a global variable.
 */
$(document).ready(function(){
	try {
		window.wiStatusListControl = new WIStatusListControl("#wi-StatusListControl")

	}
	catch (e) {
		if (console.error !== wiConsole.error)
			console.error("fdsnws.js: " + e.message)

		wiConsole.error("fdsnws.js: " + e.message, e)
	}
})


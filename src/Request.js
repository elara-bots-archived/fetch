const { join } = require("node:path")
const http = require("node:http")
const https = require("node:https")
const qs = require("node:querystring")
const zlib = require("node:zlib")
const { URL } = require("node:url")
const Response = require("./Response.js")
const supportedCompressions = ["gzip", "deflate"]

module.exports = class Request {
	constructor (url, method = "GET") {
		this.url = typeof url === "string" ? new URL(url) : url
		this.method = method
		this.data = null
		this.sendDataAs = null
		this.reqHeaders = {}
		this.streamEnabled = false
		this.compressionEnabled = false
		this.timeoutTime = null
		this.coreOptions = {}
		this.resOptions = {
			"maxBuffer": 50 * 1000000 // 50 MB
		}
		return this
	}

	query (a1, a2) {
		if (typeof a1 === "object") {
			Object.keys(a1)
			.forEach(key => this.url.searchParams.append(key, a1[key]))
		} else this.url.searchParams.append(a1, a2)
		return this
	}

	path (relativePath) {
		this.url.pathname = join(this.url.pathname, relativePath)
		return this
	}

	body (data, sendAs) {
		this.sendDataAs = typeof data === "object" && !sendAs && !Buffer.isBuffer(data) ? "json" : (sendAs ? sendAs.toLowerCase() : "buffer")
		this.data = this.sendDataAs === "form" ? qs.stringify(data) : (this.sendDataAs === "json" ? JSON.stringify(data) : data)
		return this
	}

	header (a1, a2) {
		if (typeof a1 === "object") {
			Object.keys(a1)
			.forEach(name => this.reqHeaders[name.toLowerCase()] = a1[name]);
		} else this.reqHeaders[a1.toLowerCase()] = a2
		return this
	}

	timeout (timeout) {
		this.timeoutTime = timeout
		return this
	}

	option (name, value) {
		this.coreOptions[name] = value
		return this
	}

	stream () {
		this.streamEnabled = true
		return this
	}

	compress () {
		this.compressionEnabled = true
		if (!this.reqHeaders["accept-encoding"]) this.reqHeaders["accept-encoding"] = supportedCompressions.join(", ")
		return this
	}

	send () {
		return new Promise((resolve, reject) => {
			if (this.data) {
				if (!this.reqHeaders.hasOwnProperty("content-type")) {
					if (this.sendDataAs === "json") this.reqHeaders["content-type"] = "application/json"
					else if (this.sendDataAs === "form") this.reqHeaders["content-type"] = "application/x-www-form-urlencoded"
				}

				if (!this.reqHeaders.hasOwnProperty("content-length")) this.reqHeaders["content-length"] = Buffer.byteLength(this.data)
			}

			const options = Object.assign({
				protocol: this.url.protocol,
				host: this.url.hostname,
				port: this.url.port,
				path: this.url.pathname + (this.url.search === null ? "" : this.url.search),
				method: this.method,
				headers: this.reqHeaders
			}, this.coreOptions)

			let req

			const resHandler = (res) => {
                let stream = res,
                    Res;
				if (this.compressionEnabled) {
					if (res.headers["content-encoding"] === "gzip") stream = res.pipe(zlib.createGunzip())
					else if (res.headers["content-encoding"] === "deflate") stream = res.pipe(zlib.createInflate())
				}

				if (this.streamEnabled) resolve(stream)
				else {
					Res = new Response(res, this.resOptions)
					stream.on("error", (err) => reject(err))
					stream.on("aborted", () => reject(new Error("Server aborted request")))

					stream.on("data", (chunk) => {
						Res._addChunk(chunk)

						if (this.resOptions.maxBuffer !== null && Res.body.length > this.resOptions.maxBuffer) {
							stream.destroy()
							reject(`Received a response which was longer than acceptable when buffering. (${this.body.length} bytes)`)
						}
					})
					stream.on("end", () => resolve(Res))
				}
			}

			if (this.url.protocol === "http:") req = http.request(options, resHandler)
			else if (this.url.protocol === "https:") req = https.request(options, resHandler)
			else throw new Error(`Bad URL protocol: ${this.url.protocol}`)

			if (this.timeoutTime) {
				req.setTimeout(this.timeoutTime, () => {
					req.abort()
					if (!this.streamEnabled) reject(new Error("Timeout reached"))
				})
			}

			req.on("error", (err) => reject(err))

			if (this.data) req.write(this.data)

			req.end()
		})
	}
}

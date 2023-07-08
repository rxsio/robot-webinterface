const express = require('express')
const https = require('https')
const http = require('http')
const path = require('path')
const fs = require('fs')
const app = express()

const distDir = path.join(__dirname, '..', 'dist')
const certDir = path.join(__dirname, '..', '..', 'certificates')

app.use(express.static(distDir))

app.use('/rxsioCA.pem', (req, res) => {
    res.sendFile(path.join(certDir, 'RootCA.pem'))
})

app.use('/', (req, res) => {
    res.sendFile(path.join(distDir, 'index.html'))
})

const sslOptions = {
    key: fs.readFileSync(path.join(certDir, 'firo.key')),
    cert: fs.readFileSync(path.join(certDir, 'firo.crt')),
}

http.createServer(app).listen(80, () =>
    console.log('HTTP server running at 80')
)
https
    .createServer(sslOptions, app)
    .listen(443, () => console.log('HTTPS server running at 4443'))

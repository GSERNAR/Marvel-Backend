require('dotenv').config()
var fs = require('fs')
const http = require('http')
const express = require('express')
const cors = require('cors')
const path = require('path')
const { Server } = require('socket.io')
const app = express()
const httpServer = http.createServer(app)

const io = new Server(httpServer, {
    cors: { origin: '*', methods: ['GET', 'POST'] }
})
global.io = io

const dbConnect = require('./config/mongo')

app.use(cors())
app.use(express.json())

const {
    PORT = 5000,
    SERVE_PATH = 'public'
} = process.env

const attributeController = require('./controllers/attributes')

httpServer.listen(PORT, async () => {
    console.log(fs.readFileSync('./assets/banner.txt').toString('utf-8'))
    console.log(`\nRunning app on: http://localhost:${PORT}`)
    try {
        await dbConnect()
        console.log('Database connected!')
    } catch (error) {
        console.error('Database connection error', error)
    }

    console.log('\nServer started!\n')

    await attributeController.bootstrap()
})

app.use('/api', require('./routes'))

// Serve frontend
app.use(express.static(path.join(__dirname, SERVE_PATH)))

app.use('/*', (_, res) => {
    res.sendFile(path.join(__dirname, SERVE_PATH, 'index.html'))
})


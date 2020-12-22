require('dotenv').config()

//for Azure
const session = require('express-session')
const flash = require('connect-flash')
const msal = require('@azure/msal-node')
var createError = require('http-errors')
var cookieParser = require('cookie-parser')
//var logger = require('morgan')


//for onyx
const config = require('config')
const fs = require('fs')
const express = require('express')
const path = require('path')
//const spdy = require('spdy') //for https

const cors = require('cors')
const morgan = require('morgan')
const MBTiles = require('@mapbox/mbtiles')
const TimeFormat = require('hh-mm-ss')
const winston = require('winston')
const DailyRotateFile = require('winston-daily-rotate-file')


// config constants
const morganFormat = config.get('morganFormat')
const htdocsPath = config.get('htdocsPath')
const privkeyPath = config.get('privkeyPath')
const fullchainPath = config.get('fullchainPath')
const port = config.get('port')
const defaultZ = config.get('defaultZ')
const mbtilesDir = config.get('mbtilesDir')
const fontsDir = config.get('fontsDir')
const logDirPath = config.get('logDirPath')

// global variables
let mbtilesPool = {}
let tz = config.get('tz')
let busy = false

// logger configuration
const logger = winston.createLogger({
    transports: [
        new winston.transports.Console(),
        new DailyRotateFile({
            filename: `${logDirPath}/onyx-%DATE%.log`,
            datePattern: 'YYYY-MM-DD'
        })
    ]
})

logger.stream = {
    write: (message) => { logger.info(message.trim()) }
}



var authRouter = require('./routes/auth') //before app
const app = express()

//(before indexRouter) from here
// In-memory storage of logged-in users
// For demo purposes only, production apps should store
// this in a reliable storage
app.locals.users = {};

// MSAL config
const msalConfig = {
    auth: {
        clientId: process.env.OAUTH_APP_ID,
        authority: process.env.OAUTH_AUTHORITY,
        clientSecret: process.env.OAUTH_APP_SECRET
    },
    system: {
        loggerOptions: {
            loggerCallback(loglevel, message, containsPii) {
                console.log(message);
            },
            piiLoggingEnabled: false,
            logLevel: msal.LogLevel.Verbose,
        }
    }
};

// Create msal application object
app.locals.msalClient = new msal.ConfidentialClientApplication(msalConfig);
//(before indexRouter) until here


var indexRouter = require('./routes/index')
var usersRouter = require('./routes/users')







// Session middleware
// NOTE: Uses default in-memory session store, which is not
// suitable for production
app.use(session({
    secret: 'your secreat',
    resave: false,
    saveUninitialized: false,
    unset: 'destroy'
}))

// Flash middleware
app.use(flash())

// Set up local vars for template layout
app.use(function (req, res, next) {
    // Read any flashed errors and save
    // in the response locals
    res.locals.error = req.flash('error_msg')

    // Check for simple error string and
    // convert to layout's expected format
    var errs = req.flash('error')
    for (var i in errs) {
        res.locals.error.push({ message: 'An error occurred', debug: errs[i] })
    }

    // Check for an authenticated user and load
    // into response locals
    if (req.session.userId) {
        res.locals.user = app.locals.users[req.session.userId]
    }

    next()
})


// view engine setup
app.set('views', path.join(__dirname, 'views'))
app.set('view engine', 'hbs')
//app.use(logger('dev'))
app.use(morgan(morganFormat, {
    stream: logger.stream
}))

app.use(express.json())
app.use(express.urlencoded({ extended: false }))
app.use(cookieParser())

//app.use(express.static('public'))
//app.use(express.static(path.join(__dirname, 'public')))
app.use(express.static(path.join(__dirname, htdocsPath)))

app.use('/', indexRouter)
app.use('/auth', authRouter) //after app.use('/', indexRouter)
app.use('/users', usersRouter)
app.use(cors())

const getMBTiles = async (t, z, x, y) => {
    let mbtilesPath = ''
    if (!tz[t]) tz[t] = defaultZ
    if (z < tz[t]) {
        mbtilesPath = `${mbtilesDir}/${t}/0-0-0.mbtiles`
    } else {
        mbtilesPath =
            `${mbtilesDir}/${t}/${tz[t]}-${x >> (z - tz[t])}-${y >> (z - tz[t])}.mbtiles`
    }
    return new Promise((resolve, reject) => {
        if (mbtilesPool[mbtilesPath]) {
            resolve(mbtilesPool[mbtilesPath].mbtiles)
        } else {
            if (fs.existsSync(mbtilesPath)) {
                new MBTiles(`${mbtilesPath}?mode=ro`, (err, mbtiles) => {
                    if (err) {
                        reject(new Error(`${mbtilesPath} could not open.`))
                    } else {
                        mbtilesPool[mbtilesPath] = {
                            mbtiles: mbtiles, openTime: new Date()
                        }
                        resolve(mbtilesPool[mbtilesPath].mbtiles)
                    }
                })
            } else {
                reject(new Error(`${mbtilesPath} was not found.`))
            }
        }
    })
}

const getTile = async (mbtiles, z, x, y) => {
    return new Promise((resolve, reject) => {
        mbtiles.getTile(z, x, y, (err, tile, headers) => {
            if (err) {
                reject()
            } else {
                resolve({ tile: tile, headers: headers })
            }
        })
    })
}

app.get(`/zxy/:t/:z/:x/:y.pbf`, async (req, res) => {
    busy = true
    const t = req.params.t
    const z = parseInt(req.params.z)
    const x = parseInt(req.params.x)
    const y = parseInt(req.params.y)
    getMBTiles(t, z, x, y).then(mbtiles => {
        getTile(mbtiles, z, x, y).then(r => {
            if (r.tile) {
                res.set('content-type', 'application/vnd.mapbox-vector-tile')
                res.set('content-encoding', 'gzip')
                res.set('last-modified', r.headers['Last-Modified'])
                res.set('etag', r.headers['ETag'])
                res.send(r.tile)
                busy = false
            } else {
                res.status(404).send(`tile not found: /zxy/${t}/${z}/${x}/${y}.pbf`)
                busy = false
            }
        }).catch(e => {
            res.status(404).send(`tile not found: /zxy/${t}/${z}/${x}/${y}.pbf`)
            busy = false
        })
    }).catch(e => {
        res.status(404).send(`mbtiles not found for /zxy/${t}/${z}/${x}/${y}.pbf`)
    })
})

app.get(`/fonts/:fontstack/:range.pbf`, (req, res) => {
    res.set('content-type', 'application/x-protobuf')
    res.set('content-encoding', 'gzip')
    for (const fontstack of req.params.fontstack.split(',')) {
        //const path = `${fontsDir}/${fontstack}/${req.params.range}.pbf.gz`
        //if (fs.existsSync(path)) {
        //    res.send(fs.readFileSync(path))
        const pathgz = `${fontsDir}/${fontstack}/${req.params.range}.pbf.gz`
        if (fs.existsSync(pathgz)) {
            res.send(fs.readFileSync(pathgz))
            return
        }
    }
    res.status(404).send(`font not found: ${req.params.fontstack}/${req.params.range}`)
})




// error handler
//app.use((req, res) => {
//    res.sendStatus(404)
//})

app.use(function (err, req, res, next) {
    // set locals, only providing error in development
    res.locals.message = err.message
    res.locals.error = req.app.get('env') === 'development' ? err : {}

    // render the error page
    res.status(err.status || 500)
    res.render('error')
})



////for https
//spdy.createServer({
//    key: fs.readFileSync(privkeyPath),
//   cert: fs.readFileSync(fullchainPath)
//}, app).listen(port)

//for http
app.listen(port, () => {
    console.log(`Running at Port ${port} ...`)
})



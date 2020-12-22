# az-onyx-http
First trial with http to add Azure AD authentication to un-vector-tile-toolkit/onyx

## background
I wanted to have a simple, scalable, fast, and interoperable vector tile server as a part of the UN Vector Tile Toolkit. 

## install
```console
npm install -g pm2
git clone git@github.com:ubukawa/az-onyx-http
cd az-onyx-http
npm install
mkdir config
vi config/default.hjson
vi .env
```

## an example of config/default.hjson
```console
{
  morganFormat: tiny
  htdocsPath: htdocs
  port: 3000
  logDirPath: log
  tz: {
    tapioca: 6
  }
  defaultZ: 6
  mbtilesDir: /somewhere/mbtiles
  fontsDir: /somewhere/fonts
}
```


## run
```console
node app.js
```

## References
https://docs.microsoft.com/en-us/graph/tutorials/node?tutorial-step=3  
https://github.com/un-vector-tile-toolkit/onyx




var Q = require('q')
var Url = require('url')
var Http = require('http')
var GetPocket = require('node-getpocket')

var PORT = process.env.PORT || 8080
var PROTOCOL = process.env.PROTOCOL || 'http'
var HOSTNAME = process.env.HOSTNAME || 'localhost:8080'

var CONSUMER_KEY = '60504-58dc4050e9867ff1204e456b'
var REDIRECT_URI = PROTOCOL + '://' + HOSTNAME + '/redirect'

var pocket
var pocketConfig

function initializePocket () {
  pocketConfig = {}
  pocketConfig.consumer_key = CONSUMER_KEY
  pocketConfig.redirect_uri = REDIRECT_URI

  pocket = new GetPocket(pocketConfig)

    // dummy promise
  return Q()
}

function initializeServer () {
  let server = Http.createServer(onRequest)
  server.listen(PORT)

  console.log('server running')
}

function onRequest (request, response) {
  let urlObject = Url.parse(request.url, true)

  if (urlObject.pathname === '/') {
    let promise = fetchRequestToken()
    promise.then(function (requestToken) {
      let pocketOptions = {}
      pocketOptions.request_token = requestToken
      pocketOptions.redirect_uri = REDIRECT_URI + '?requestToken=' + requestToken

      let authorizeUrl = pocket.getAuthorizeURL(pocketOptions)

      let responseHeaders = {}
      responseHeaders['Location'] = authorizeUrl

      response.writeHead(302, responseHeaders)
      response.end()
    })
  } else if (urlObject.pathname === '/redirect') {
    let requestToken = urlObject.query.requestToken

    let promise = fetchAccessToken(requestToken)
    promise = promise.then(function (accessToken) {
      let responseHeaders = {}
      responseHeaders['Location'] = '/domains?accessToken=' + accessToken + '&threshold=0'

      response.writeHead(302, responseHeaders)
      response.end()
    })

    promise.catch(function (error) {
      console.error('request failed', error)

      response.statusCode = 500
      response.end()
    })
  } else if (urlObject.pathname === '/domains') {
    let accessToken = urlObject.query.accessToken
    let threshold = urlObject.query.threshold || 0

    let promise = fetchArticles(accessToken)
    promise = promise.then(function (articles) {
      articles = articles.list

      let countForDomain = {}
      for (let articleId in articles) {
        let article = articles[articleId]
        let articleUrl = article.resolved_url || article.given_url

        let parsedUrl = Url.parse(articleUrl)
        let articleDomain = parsedUrl.hostname

        let count = countForDomain[articleDomain] || 0
        count++

        countForDomain[articleDomain] = count
      }

      for (let domain in countForDomain) {
        let count = countForDomain[domain]
        if (count < threshold) {
          delete countForDomain[domain]
        }
      }

      let responseString = JSON.stringify(countForDomain)
      response.end(responseString)
    })

    promise.catch(function (error) {
      console.error('request failed', error)

      response.statusCode = 500
      response.end()
    })
  } else {
    response.statusCode = 404
    response.end()
  }
}

function fetchRequestToken () {
  let future = Q.defer()

  let pocketOptions = {}
  pocketOptions.redirect_uri = pocketConfig.redirect_uri

  pocket.getRequestToken(pocketOptions, function (error, response, body) {
    if (error) {
      console.log('failed to fetch requestToken', error)

      future.reject(error)
      return
    }

    let json = JSON.parse(body)
    let requestToken = json.code

    future.resolve(requestToken)
  })

  return future.promise
}

function fetchAccessToken (requestToken) {
  let future = Q.defer()

  let pocketOptions = {
    request_token: requestToken
  }

  pocket.getAccessToken(pocketOptions, function (error, response, body) {
    if (error) {
      console.log('failed to fetch accessToken', error)

      future.reject(error)
      return
    }

    let json = JSON.parse(body)
    let accessToken = json.access_token

    future.resolve(accessToken)
  })

  return future.promise
}

function fetchArticles (accessToken) {
  let future = Q.defer()

  pocketConfig.access_token = accessToken
  pocket.refreshConfig(pocketConfig)

  let pocketOptions = {
    state: 'all',
    detailType: 'simple'
  }

  pocket.get(pocketOptions, function (error, response) {
    if (error) {
      console.error('failed to fetch articles', error)

      future.reject(error)
      return
    }

    future.resolve(response)
  })

  pocketConfig.access_token = null
  pocket.refreshConfig(pocketConfig)

  return future.promise
}

let promise = initializePocket()
promise = promise.then(initializeServer)
promise.catch(function (error) {
  console.error('initialization failed', error)
  process.exit(1)
})

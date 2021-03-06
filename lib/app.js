var Markets = require('./markets.js')
var lib = require('./lib.js')
var _ = require('lodash')
var anydbsql = require('anydb-sql')
var fs = require('fs')
var glob = require('glob')
var path = require('path')
var md5 = require('md5')
var chalk = require('chalk')
module.exports = {
  markets: null,
  database: null,
  databaseConnected: false,
  databaseSettings: {
    engine: null, // mysql, postgresql, sqlite (or sqlite3) etc.
    host: null, // localhost, 127.0.0.1
    database: null, // database_name
    username: null, // user name
    password: null, // password
    port: 0 // port
  },
  availablePlugins: [],
  activePlugins: [],
  applicationDataFolder: 'application_data/',
  pluginsFolder: 'plugins/',
  pluginsDataPath: null,
  appSettingsPath: null,
  databaseSettingsDataPath: null,
  output: true,
  rawPassword: null,
  settings: {
    password: null
  },
  log: function (log) {
    if (this.output) {
      console.log(log)
    }
  },
  prerequisite: function () {
    var self = this
    self.markets = new Markets()
    //
    // check application data folder is exists
    // if not exist create it
    //
    if (!fs.existsSync(self.applicationDataFolder)) {
      fs.mkdirSync(self.applicationDataFolder)
    }
    //
    // set property value to absolute path for
    // future references
    //
    self.applicationDataFolder = fs.realpathSync(self.applicationDataFolder)
    self.appSettingsPath = path.join(self.applicationDataFolder, 'settings.json')
    self.markets.settingsFilePath = path.join(self.applicationDataFolder, 'markets.json')
    self.pluginsDataPath = path.join(self.applicationDataFolder, 'plugins.json')
    self.databaseSettingsDataPath = path.join(self.applicationDataFolder, 'database_settings.json')
    if (!fs.existsSync(self.appSettingsPath)) {
      //
      // create file
      //
      fs.openSync(self.appSettingsPath, 'w+')
      //
      // save empty array to new created file
      //
      self.writeSettings()
    }
    if (!fs.existsSync(self.markets.settingsFilePath)) {
      //
      // create file
      //
      fs.openSync(self.markets.settingsFilePath, 'w+')
      //
      // save empty array to new created file
      //
      self.markets.save()
    }
    if (!fs.existsSync(self.pluginsDataPath)) {
      self.writePlugins()
    }
    if (!fs.existsSync(self.databaseSettingsDataPath)) {
      self.writeDatabaseSettings()
    }
    self.markets.settingsFilePath = fs.realpathSync(self.markets.settingsFilePath)
    if (!fs.existsSync(self.pluginsFolder)) {
      fs.mkdirSync(self.pluginsFolder)
    }
  },
  initializePlugins: function () {
    var self = this
    var files = glob.sync(self.pluginsFolder + '*.js', {
      cwd: __dirname
    })
    var hasNewPlugin = false
    self.readPlugins()
    var olds = self.activePlugins
    self.activePlugins = []
    self.availablePlugins = []
    files.forEach(file => {
      var filePath = path.join(__dirname, file)
      var x = require(filePath)
      var willCall = true
      var index = _.findIndex(olds, function (o) {
        return o.name === x.name
      })

      if (index === -1) {
        hasNewPlugin = true
      } else {
        if (olds[index].enabled === false) {
          willCall = false
        }
      }
      if (willCall) {
        self.activePlugins.push({
          file: file,
          name: x.name,
          enabled: true,
          instance: x
        })
        var hasSettings = x.prototype.hasSettings !== undefined && x.prototype.hasSettings
        var ind = self.activePlugins.length - 1
        self.activePlugins[ind].instance.call(self.activePlugins[ind].instance, null, self)
        // x.call(x, null, self)
        if (hasSettings) {
          self.activePlugins[ind].instance.prototype.readSettings(this)
        }
      } else {
        self.availablePlugins.push({
          file: file,
          name: x.name
        })
      }
    })
    if (hasNewPlugin) {
      self.log('New plugin(s) detected. Saving plugins')
      self.writePlugins()
    }
  },
  initializeDatabase: function () {
    var self = this
    self.readDatabaseSettings()
    var driver = null
    switch (self.databaseSettings.engine) {
    case 'mysql':
      driver = 'mysql://' + self.databaseSettings.username
      if (!_.isNull(self.databaseSettings.password)) {
        driver += ':' + self.databaseSettings.password
      }
      driver += '@' + self.databaseSettings.host
      if (self.databaseSettings.port !== 3306) {
        driver += ':' + self.databaseSettings.port
      }
      driver += '/' + self.databaseSettings.database
      break
    default:
      self.log('Please correct database settings')
      return false
    }
    self.database = anydbsql({
      url: driver
    })
    self.databaseConnected = self.checkDatabaseConnection()
  },
  checkDatabaseConnection: function () {
    var self = this
    var testTable = self.database.define({
      name: 'test',
      columns: {
        id: {
          dataType: 'int'
        }
      }
    })
    self.database.query(testTable.create()
      .ifNotExists()
      .toQuery()
      .text,
      function (err) {
        if (err !== null) {
          if (err.errno === 'ECONNREFUSED' || err.errno === 'ETIMEDOUT') {
            return false
          }
          self.log(err)
        }
      })
    return true
  },
  readSettings: function () {
    var self = this
    self.settings = JSON.parse(fs.readFileSync(self.appSettingsPath, 'utf-8'))
  },
  writeSettings: function () {
    var self = this
    fs.writeFileSync(self.appSettingsPath, JSON.stringify(self.settings))
  },
  changePassword: function (newPassword) {
    var self = this
    var oldPassword = self.rawPassword
    if (oldPassword !== null) {
      _.each(self.markets.markets, function (market, index) {
        self.markets.markets[index].apiKey = lib.aesDecrypt(market.apiKey, oldPassword)
        self.markets.markets[index].apiSecret = lib.aesDecrypt(market.apiSecret, oldPassword)
      })
    }
    _.each(self.markets.markets, function (market, index) {
      self.markets.markets[index].apiKey = lib.aesEncrypt(market.apiKey, newPassword)
      self.markets.markets[index].apiSecret = lib.aesEncrypt(market.apiSecret, newPassword)
    })
    self.settings.password = md5(newPassword)
    self.rawPassword = newPassword
    self.markets.save()
    self.writeSettings()
  },
  readPlugins: function () {
    var self = this
    self.activePlugins = JSON.parse(fs.readFileSync(self.pluginsDataPath, 'utf-8'))
  },
  writePlugins: function () {
    var self = this
    fs.writeFileSync(self.pluginsDataPath, JSON.stringify(self.activePlugins))
  },
  readDatabaseSettings: function () {
    var self = this
    self.databaseSettings = JSON.parse(fs.readFileSync(self.databaseSettingsDataPath, 'utf-8'))
  },
  writeDatabaseSettings: function () {
    var self = this
    fs.writeFileSync(self.databaseSettingsDataPath, JSON.stringify(self.databaseSettings))
  },
  init: function (password) {
    var self = this
    self.readSettings()
    if (self.settings.password === null) {
      self.log(chalk.yellow('You didn\'t set any master password. If you do not set any password, your API secrets will be readable!'))
      self.log(chalk.cyan('You may set or change password with `passwd` command'))

    } else {
      self.rawPassword = password
      if (md5(self.rawPassword) != self.settings.password) {
        self.log(chalk.red('Password is not correct. Exiting...'))
        process.exit(0)
      }

    }
    self.initializePlugins()
    self.initializeDatabase()
    self.markets.init()
    if (self.settings.password === null) {
      _.each(self.markets.markets, function (market, index) {
        self.markets.markets[index]._apiKey = market.apiKey
        self.markets.markets[index]._apiSecret = market.apiSecret
      })
    } else {
      _.each(self.markets.markets, function (market, index) {
        self.markets.markets[index]._apiKey = lib.aesDecrypt(market.apiKey, self.settings.password)
        self.markets.markets[index]._apiSecret = lib.aesDecrypt(market.apiSecret, self.settings.password)
      })
    }
    if (self.databaseConnected) {
      self.markets.on('market_pair_added', function (market, pair) {
        var publicTrades = self.database.define({
          name: _.kebabCase(market.name) + '_pt_' + pair.currency1.toLowerCase() + '_' + pair.currency2.toLowerCase(),
          columns: {
            date: {
              dataType: 'timestamp',
              notNull: true
            },
            tradeType: {
              dataType: 'int',
              notNull: true
            },
            rate: {
              dataType: 'double',
              notNull: true
            },
            amount: {
              dataType: 'double',
              notNull: true
            },
            total: {
              dataType: 'double',
              notNull: false
            }
          }
        })
        self.database.query(publicTrades.create()
          .ifNotExists()
          .toQuery()
          .text)
      })
      self.markets.on('market_pair_tick', function (market, pair) {
        var publicTrades = self.database.define({
          name: _.kebabCase(market.name) + '_pt_' + pair.currency1.toLowerCase() + '_' + pair.currency2.toLowerCase(),
          columns: {
            date: {
              dataType: 'timestamp',
              notNull: true
            },
            tradeType: {
              dataType: 'int',
              notNull: true
            },
            rate: {
              dataType: 'double',
              notNull: true
            },
            amount: {
              dataType: 'double',
              notNull: true
            },
            total: {
              dataType: 'double',
              notNull: false
            }
          }
        })
        var tx = self.database.begin()
        _.each(pair.publicTrades, function (order) {
          publicTrades.insert(publicTrades.date.value(order.timestamp), publicTrades.tradeType.value(order.tradeType === 'sell' ? 0 : 1), publicTrades.rate.value(order.rate), publicTrades.amount.value(order.amount), publicTrades.total.value(order.total))
            .execWithin(tx)
        })
        tx.commit()
      })
    }
    self.markets.load(self.rawPassword)
  }
}
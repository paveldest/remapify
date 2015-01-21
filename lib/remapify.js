 'use strict';

var _ = require('lodash')
  , aliasify = require('aliasify')
  , Glob = require('glob').Glob
  , path = require('path')
  , async = require('async')
  , eachPattern
  , eachFile
  , setLogger
  , log
  , transformAliases

setLogger = function setLogger(verbose){
  if (!verbose) log = _.noop
  else {
    log = function logger(){
      return console.info.apply(console
        , ['remapify - ']
        .concat([].slice.call(arguments, 0))
      )
    }
  }
}

// expects to be called with the context of a bundle
transformAliases = function transformAliases(err, results){
  if (err) {
    log(err)
    return void this.emit('error', err)
  }

  var expandedAliasesCount = _(results).pluck('aliases').map(_.size).reduce(function sum(total, count){
      return total += count
    }).valueOf()

  if (expandedAliasesCount) {
    log('exposing ' + expandedAliasesCount + ' aliases.')

    _.each(results, function eachExpandedAliasGroup(result){
      _(result.aliases).values().uniq().each(function applyAlasifyForEachExpandedAlias(file){
        console.log('hi', file)
        this.pipeline.get('deps').push(aliasify.configure({
          aliases: result
          , configDir: result.pattern.cwd
        })(file))
      }, this)
    }, this)
  }
  else {
    log('no aliases found to expose.')
  }
}

// expects to be called with the context of a bundle
eachFile = function eachFile(file, pattern, globber){
  var processCwd = process.cwd()
    , cwd = globber.cwd || processCwd
    // we'll send the process-relative path to aliasify
    , aliasifyFilePath = './' + path.relative(process.cwd(), path.resolve(path.join(cwd, file)))
    // we'll use the relative path to create our alias
    , relativeFilePath = file.replace(cwd, '')
    // append the expose path
    , alias = path.join((pattern.expose || ''), relativeFilePath)
    , extStripper = new RegExp('(.*?)(' + this._extensions.join('$|\\') + ')$')
    , splitPath = alias.split(path.sep)
    , expandedAliases = {}

  // accomadate both windows and *nix file paths
  _(['/', '\\']).each(function forEachSep(sep){
    var alias = splitPath.join(sep)
      , aliasWithNoExt = alias.match(extStripper)
      , lastIndex

    // expose both with and with out the js extension to match normal require behavior
    expandedAliases[alias] = aliasifyFilePath
    // if the file ext matches a known browserify extension, alias it, without the extensions
    if (aliasWithNoExt[1])
      expandedAliases[aliasWithNoExt[1]] = aliasifyFilePath
    // if the filter option is passed, call it with the alias and add it's result
    if (pattern.filter){
      if (sep === path.sep)
        expandedAliases[pattern.filter(alias, path.dirname(alias), path.basename(alias))] = aliasifyFilePath
      else {
        lastIndex = alias.lastIndexOf(sep)
        if (lastIndex < 0){
          expandedAliases[pattern.filter(alias, '.', alias).split(path.sep).join(sep)] = aliasifyFilePath
        }
        else {
          expandedAliases[pattern.filter(alias
            , alias.substring(0, lastIndex)
            , alias.substring(lastIndex + 1)).split(path.sep).join(sep)] = aliasifyFilePath
        }
      }
    }
  })

  return expandedAliases
}

// expects to be called with the context of a bundle
eachPattern = function forEachPattern(pattern, callback){
  var expandedAliases = {}
    , globber

  globber = new Glob(pattern.src, pattern)
    .on('error', callback)
    .on('match', function onGlobMatch(file){
      var aliasesForFile = eachFile.call(this, file, pattern, globber)
      _.extend(expandedAliases, aliasesForFile)
      log('found', aliasesForFile)
    }.bind(this))
    .on('end', function globEnd(files){
      this.emit('remapify:files', files, expandedAliases, globber, pattern)
      callback(null, {pattern: pattern, aliases: expandedAliases})
    }.bind(this))
}

module.exports = function remapify(b, options){
  options = _.defaults(options || {}, {
    config: {
      verbose: false
    }
  })

  var patterns = _.isArray(options)
      ? _.clone(options)
      : [_.clone(options)]

  setLogger(options.config.verbose)

  async.map(patterns, eachPattern.bind(b), transformAliases.bind(b))
}

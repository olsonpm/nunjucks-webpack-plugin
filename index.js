'use strict'

const fs = require('fs-extra')
const nunjucks = require('nunjucks')
const path = require('path')

const pluginName = 'NunjucksWebpackPlugin'

class NunjucksWebpackPlugin {
  constructor(options) {
    this.options = Object.assign(
      {},
      {
        configure: {
          options: {},
          path: '',
        },
        templates: [],
      },
      options || {}
    )

    if (
      !Array.isArray(this.options.templates) ||
      this.options.templates.length === 0
    ) {
      throw new Error('Options `templates` must be an empty array')
    }
  }

  apply(compiler) {
    const fileDependencies = []

    let output = compiler.options.output.path

    if (
      output === '/' &&
      compiler.options.devServer &&
      compiler.options.devServer.outputPath
    ) {
      output = compiler.options.devServer.outputPath
    }

    const emitCallback = (compilation, callback) => {
      const configure =
        this.options.configure instanceof nunjucks.Environment
          ? this.options.configure
          : nunjucks.configure(
              this.options.configure.path,
              this.options.configure.options
            )

      const promises = []

      this.options.templates.forEach(template => {
        if (!template.from) {
          throw new Error('Each template should have `from` option')
        }

        if (!template.to) {
          throw new Error('Each template should have `to` option')
        }

        if (fileDependencies.indexOf(template.from) === -1) {
          fileDependencies.push(template.from)
        }

        const context = createContext(template.context, compilation)

        const res = configure.render(
          template.from,
          context,
          template.callback ? template.callback : null
        )

        let webpackTo = template.to

        if (path.isAbsolute(webpackTo)) {
          webpackTo = path.relative(output, webpackTo)
        }

        const source = {
          size: () => res.length,
          source: () => res,
        }

        compilation.assets[webpackTo] = source

        if (template.writeToFileEmit) {
          const fileDest = path.join(output, webpackTo)

          promises.push(fs.outputFile(fileDest, source.source()))
        }
      })

      return (
        Promise.all(promises)
          // eslint-disable-next-line promise/no-callback-in-promise
          .then(() => callback())
          .catch(error => {
            compilation.errors.push(error)

            // eslint-disable-next-line promise/no-callback-in-promise
            return callback()
          })
      )
    }

    const afterEmitCallback = (compilation, callback) => {
      let compilationFileDependencies = compilation.fileDependencies
      let addFileDependency = file => compilation.fileDependencies.add(file)

      if (Array.isArray(compilation.fileDependencies)) {
        compilationFileDependencies = new Set(compilation.fileDependencies)
        addFileDependency = file => compilation.fileDependencies.push(file)
      }

      for (const file of fileDependencies) {
        if (!compilationFileDependencies.has(file)) {
          addFileDependency(file)
        }
      }

      return callback()
    }

    if (compiler.hooks) {
      compiler.hooks.emit.tapAsync(pluginName, emitCallback)
      compiler.hooks.afterEmit.tapAsync(pluginName, afterEmitCallback)
    } else {
      compiler.plugin('emit', emitCallback)
      compiler.plugin('after-emit', afterEmitCallback)
    }
  }
}

function createContext(templateContext, compilation) {
  return Object.assign(
    {
      nunjucksWebpackPlugin: getPluginContext(compilation),
    },
    templateContext || {}
  )
}

function getPluginContext(compilation) {
  const assetNames = Object.keys(compilation.assets)
  /**
   * this is very hacky - I'm sick of figuring out the labyrinth that is webpack
   * and don't intend on coming back to this often enough to warrant the
   * time spent
   */
  const firstCssAssetName = assetNames.filter(endsWith('.css'))[0]
  let cssInline = ''
  if (firstCssAssetName) {
    const cssAsset = compilation.assets[firstCssAssetName]
    const cssStr = cssAsset.children[0]._value
    const cssSrcMappingUrlLine = cssAsset.children[1]
    cssInline = cssStr + cssSrcMappingUrlLine
  }
  return {
    js: assetNames.filter(endsWith('.js')),
    css: assetNames.filter(endsWith('.css')),
    cssInline,
  }
}

function endsWith(str) {
  return data => {
    if (data.length < str.length) return false
    else return data.slice(-str.length) === str
  }
}

module.exports = NunjucksWebpackPlugin

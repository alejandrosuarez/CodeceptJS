#!/usr/bin/env node
const fs = require('fs')
const path = require('path')
const axios = require('axios')
const documentation = require('documentation')
const {
  stopOnFail,
  chdir,
  tasks: { git, copy, exec, replaceInFile, npmRun, npx, writeToFile },
  runok,
} = require('runok')
const contributors = require('contributor-faces')
const { execSync } = require('node:child_process')
const semver = require('semver')

const helperMarkDownFile = function (name) {
  return `docs/helpers/${name}.md`
}
const documentjsCliArgs = '-f md --shallow --markdown-toc=false --sort-order=alpha'

stopOnFail()

module.exports = {
  async docs() {
    // generate all docs (runs all docs:* commands in parallel)
    await Promise.all([this.docsHelpers(), this.docsPlugins(), this.docsExternalHelpers()])
  },

  async def() {
    await Promise.all([this.buildLibWithDocs(true), this.docsPlugins(), this.docsExternalHelpers()])
    await this.defTypings()
  },

  async defTypings() {
    console.log('Generate TypeScript definition')
    // Generate definitions for promised-based helper methods
    await npx('jsdoc -c typings/jsdocPromiseBased.conf.js')
    fs.renameSync('typings/types.d.ts', 'typings/promiseBasedTypes.d.ts')
    // Generate all other regular definitions
    await npx('jsdoc -c typings/jsdoc.conf.js')
  },

  async docsPlugins() {
    // generate documentation for plugins
    await npx(`documentation build lib/plugin/*.js -o docs/plugins.md ${documentjsCliArgs}`)
    await replaceInFile('docs/plugins.md', (cfg) => {
      cfg.replace(/^/, '---\npermalink: plugins\nsidebarDepth: \nsidebar: auto\ntitle: Plugins\n---\n\n')
    })
  },

  async docsCi() {
    // generate docs for CI services
    stopOnFail()

    writeToFile('docs/docker.md', (cfg) => {
      cfg.line('---')
      cfg.line('permalink: /docker')
      cfg.line('layout: Section')
      cfg.line('sidebar: false')
      cfg.line('title: Docker')
      cfg.line('editLink: false')
      cfg.line('---')
      cfg.line('')
      cfg.textFromFile('docker/README.md')
    })

    let body = `---
permalink: /continuous-integration
title: Continuous Integration
---

<!-- this file is auto generated from CI category https://codecept.discourse.group/c/CodeceptJS-issues-in-general/ci/9 -->

# Continuous Integration

> Help us improve this article. [Write how did you set up CodeceptJS for CI](https://codecept.discourse.group/c/CodeceptJS-issues-in-general/ci/9) and see your post listed here!

Continuous Integration services allows you to delegate the control of running tests to external system.
CodeceptJS plays well with all types of CI even when there is no documentation on this topic, it is still easy to set up with any kind of hosted or cloud CI.
Our community prepared some valuable recipes for setting up CI systems with CodeceptJS.

## Recipes

`
    const res = await axios.get('https://codecept.discourse.group/search.json?q=category%3A9')
    for (const topic of res.data.topics) {
      if (topic.slug === 'about-the-continuous-integration-category') continue
      body += `* ### [${topic.title}](https://codecept.discourse.group/t/${topic.slug}/)\n`
    }
    writeToFile('docs/continuous-integration.md', (cfg) => cfg.line(body))
  },

  async docsExternalHelpers() {
    // generate documentation for helpers outside of main repo
    console.log('Building @codecepjs/detox helper docs')
    let helper = 'Detox'
    replaceInFile(`node_modules/@codeceptjs/detox-helper/${helper}.js`, (cfg) => {
      cfg.replace(/CodeceptJS.LocatorOrString/g, 'string | object')
      cfg.replace(/LocatorOrString/g, 'string | object')
    })
    await npx(
      `documentation build node_modules/@codeceptjs/detox-helper/${helper}.js -o ${helperMarkDownFile(helper)} ${documentjsCliArgs}`,
    )

    await writeToFile(helperMarkDownFile(helper), (cfg) => {
      cfg.line(`---\npermalink: /helpers/${helper}\nsidebar: auto\ntitle: ${helper}\n---\n\n# ${helper}\n\n`)
      cfg.textFromFile(helperMarkDownFile(helper))
    })

    replaceInFile(`node_modules/@codeceptjs/detox-helper/${helper}.js`, (cfg) => {
      cfg.replace(/string \| object/g, 'CodeceptJS.LocatorOrString')
      cfg.replace(/string \| object/g, 'LocatorOrString')
    })

    console.log('Building @codeceptjs/mock-request')
    helper = 'MockRequest'
    replaceInFile('node_modules/@codeceptjs/mock-request/index.js', (cfg) => {
      cfg.replace(/CodeceptJS.LocatorOrString/g, 'string | object')
      cfg.replace(/LocatorOrString/g, 'string | object')
    })
    await npx(
      `documentation build node_modules/@codeceptjs/mock-request/index.js -o ${helperMarkDownFile(helper)} ${documentjsCliArgs}`,
    )

    await writeToFile(helperMarkDownFile(helper), (cfg) => {
      cfg.line(`---\npermalink: /helpers/${helper}\nsidebar: auto\ntitle: ${helper}\n---\n\n# ${helper}\n\n`)
      cfg.textFromFile(helperMarkDownFile(helper))
    })

    replaceInFile('node_modules/@codeceptjs/mock-request/index.js', (cfg) => {
      cfg.replace(/string \| object/g, 'CodeceptJS.LocatorOrString')
      cfg.replace(/string \| object/g, 'LocatorOrString')
    })
  },

  async docsExternalPlugins() {
    // generate documentation for helpers outside of main repo
    console.log('Building Vue plugin docs')
    const resp = await axios.get(
      'https://raw.githubusercontent.com/codecept-js/vue-cli-plugin-codeceptjs-puppeteer/master/README.md',
    )

    writeToFile('docs/vue.md', (cfg) => {
      cfg.line('---\npermalink: /vue\nlayout: Section\nsidebar: false\ntitle: Testing Vue Apps\n---\n\n')
      cfg.line(resp.data)
    })

    this.docsCi()
  },

  async buildLibWithDocs(forTypings = false) {
    // generate documentation for helpers
    const files = fs.readdirSync('lib/helper').filter((f) => path.extname(f) === '.js')

    const partials = fs.readdirSync('docs/webapi').filter((f) => path.extname(f) === '.mustache')
    const placeholders = partials.map((file) => `{{> ${path.basename(file, '.mustache')} }}`)
    const templates = partials
      .map((file) => fs.readFileSync(`docs/webapi/${file}`).toString())
      .map((template) =>
        template
          .replace(/^/gm, '   * ')
          .replace(/^/, '\n')
          .replace(/\s*\* /, ''),
      )

    for (const file of files) {
      const name = path.basename(file, '.js')
      console.log(`Building helpers with docs for ${name}`)
      copy(`lib/helper/${file}`, `docs/build/${file}`)
      replaceInFile(`docs/build/${file}`, (cfg) => {
        for (const i in placeholders) {
          cfg.replace(placeholders[i], templates[i])
        }
        if (!forTypings) {
          cfg.replace(/CodeceptJS.LocatorOrString\?/g, '(string | object)?')
          cfg.replace(/LocatorOrString\?/g, '(string | object)?')
          cfg.replace(/CodeceptJS.LocatorOrString/g, 'string | object')
          cfg.replace(/LocatorOrString/g, 'string | object')
          cfg.replace(/CodeceptJS.StringOrSecret/g, 'string | object')
        }
      })
    }
  },

  async docsHelpers() {
    // generate documentation for helpers
    const files = fs.readdirSync('lib/helper').filter((f) => path.extname(f) === '.js')

    const ignoreList = ['Polly', 'MockRequest'] // WebDriverIO won't be documented and should be removed

    const partials = fs.readdirSync('docs/webapi').filter((f) => path.extname(f) === '.mustache')
    const placeholders = partials.map((file) => `{{> ${path.basename(file, '.mustache')} }}`)
    const templates = partials
      .map((file) => fs.readFileSync(`docs/webapi/${file}`).toString())
      .map((template) =>
        template
          .replace(/^/gm, '   * ')
          .replace(/^/, '\n')
          .replace(/\s*\* /, ''),
      )

    const sharedPartials = fs.readdirSync('docs/shared').filter((f) => path.extname(f) === '.mustache')
    const sharedPlaceholders = sharedPartials.map((file) => `{{ ${path.basename(file, '.mustache')} }}`)
    const sharedTemplates = sharedPartials
      .map((file) => fs.readFileSync(`docs/shared/${file}`).toString())
      .map((template) => `\n\n\n${template}`)

    for (const file of files) {
      const name = path.basename(file, '.js')
      if (ignoreList.indexOf(name) >= 0) continue
      console.log(`Writing documentation for ${name}`)
      copy(`lib/helper/${file}`, `docs/build/${file}`)
      replaceInFile(`docs/build/${file}`, (cfg) => {
        for (const i in placeholders) {
          cfg.replace(placeholders[i], templates[i])
        }
        cfg.replace(/CodeceptJS.LocatorOrString\?/g, '(string | object)?')
        cfg.replace(/LocatorOrString\?/g, '(string | object)?')
        cfg.replace(/CodeceptJS.LocatorOrString/g, 'string | object')
        cfg.replace(/LocatorOrString/g, 'string | object')
        cfg.replace(/CodeceptJS.StringOrSecret/g, 'string | object')
      })

      await npx(`documentation build docs/build/${file} -o docs/helpers/${name}.md ${documentjsCliArgs}`)
      replaceInFile(helperMarkDownFile(name), (cfg) => {
        cfg.replace(/\(optional, default.*?\)/gm, '')
        cfg.replace(/\\*/gm, '')
      })

      replaceInFile(helperMarkDownFile(name), (cfg) => {
        for (const i in sharedPlaceholders) {
          cfg.replace(sharedPlaceholders[i], sharedTemplates[i])
        }
      })

      replaceInFile(helperMarkDownFile(name), (cfg) => {
        const regex = /## config((.|\n)*)\[1\]/m
        const fullText = fs.readFileSync(helperMarkDownFile(name)).toString()
        const text = fullText.match(regex)
        if (!text) return

        cfg.replace('<!-- configuration -->', text[1])
        cfg.replace(regex, '[1]')
      })

      if (name === 'Appium') {
        await this.docsAppium()
      }

      await writeToFile(helperMarkDownFile(name), (cfg) => {
        cfg.append(`---
permalink: /helpers/${name}
editLink: false
sidebar: auto
title: ${name}
---

`)
        cfg.textFromFile(helperMarkDownFile(name))
      })
    }
  },

  async wiki() {
    // publish wiki pages to website
    if (!fs.existsSync('docs/wiki/Home.md')) {
      await git((fn) => {
        fn.clone('git@github.com:codeceptjs/CodeceptJS.wiki.git', 'docs/wiki')
      })
    }
    await chdir('docs/wiki', () => git((cfg) => cfg.pull('origin master')))

    await writeToFile('docs/community-helpers.md', (cfg) => {
      cfg.line('---')
      cfg.line('permalink: /community-helpers')
      cfg.line('title: Community Helpers')
      cfg.line('editLink: false')
      cfg.line('---')
      cfg.line('')
      cfg.line('# Community Helpers')
      cfg.line(
        '> Share your helpers at our [Wiki Page](https://github.com/codeceptjs/CodeceptJS/wiki/Community-Helpers)',
      )
      cfg.line('')
      cfg.textFromFile('docs/wiki/Community-Helpers-&-Plugins.md')
    })

    writeToFile('docs/examples.md', (cfg) => {
      cfg.line('---')
      cfg.line('permalink: /examples')
      cfg.line('layout: Section')
      cfg.line('sidebar: false')
      cfg.line('title: Examples')
      cfg.line('editLink: false')
      cfg.line('---')
      cfg.line('')
      cfg.line('# Examples')
      cfg.line('> Add your own examples to our [Wiki Page](https://github.com/codeceptjs/CodeceptJS/wiki/Examples)')
      cfg.textFromFile('docs/wiki/Examples.md')
    })

    writeToFile('docs/books.md', (cfg) => {
      cfg.line('---')
      cfg.line('permalink: /books')
      cfg.line('layout: Section')
      cfg.line('sidebar: false')
      cfg.line('title: Books & Posts')
      cfg.line('editLink: false')
      cfg.line('---')
      cfg.line('')
      cfg.line('# Books & Posts')
      cfg.line(
        '> Add your own books or posts to our [Wiki Page](https://github.com/codeceptjs/CodeceptJS/wiki/Books-&-Posts)',
      )
      cfg.textFromFile('docs/wiki/Books-&-Posts.md')
    })

    writeToFile('docs/videos.md', (cfg) => {
      cfg.line('---')
      cfg.line('permalink: /videos')
      cfg.line('layout: Section')
      cfg.line('sidebar: false')
      cfg.line('title: Videos')
      cfg.line('editLink: false')
      cfg.line('---')
      cfg.line('')
      cfg.line('> Add your own videos to our [Wiki Page](https://github.com/codeceptjs/CodeceptJS/wiki/Videos)')
      cfg.textFromFile('docs/wiki/Videos.md')
    })
  },

  async docsAppium() {
    // generates docs for appium
    const onlyWeb = [
      /Title/,
      /Popup/,
      /Cookie/,
      /Url/,
      /^press/,
      /^refreshPage/,
      /^resizeWindow/,
      /Script$/,
      /cursor/,
      /Css/,
      /Tab$/,
      /^wait/,
    ]
    const webdriverDoc = await documentation.build(['docs/build/WebDriver.js'], {
      shallow: true,
      order: 'asc',
    })
    const doc = await documentation.build(['docs/build/Appium.js'], {
      shallow: true,
      order: 'asc',
    })

    // copy all public methods from webdriver
    for (const method of webdriverDoc[0].members.instance) {
      if (onlyWeb.filter((f) => method.name.match(f)).length) continue
      if (doc[0].members.instance.filter((m) => m.name === method.name).length) continue
      doc[0].members.instance.push(method)
    }
    const output = await documentation.formats.md(doc)
    // output is a string of Markdown data
    fs.writeFileSync('docs/helpers/Appium.md', output)
  },

  async publishSite() {
    // updates codecept.io website
    await processChangelog()
    await this.wiki()

    const dir = 'website'
    if (fs.existsSync(dir)) {
      await exec(`rm -rf ${dir}`)
    }

    await git((fn) => fn.clone('git@github.com:codeceptjs/website.git', dir))
    await copy('docs', 'website/docs')

    await chdir(dir, async () => {
      stopOnFail(false)
      await git((fn) => {
        fn.add('-A')
        fn.commit('-m "synchronized with docs"')
        fn.pull()
        fn.push()
      })
      stopOnFail(true)

      await exec('./runok.js publish')
    })
  },

  async server() {
    // run test server. Warning! PHP required!
    await Promise.all([exec('php -S 127.0.0.1:8000 -t test/data/app'), npmRun('json-server')])
  },

  async release(releaseType = null) {
    const packageInfo = JSON.parse(fs.readFileSync('package.json'))
    // Releases CodeceptJS. You can pass in argument "patch", "minor", "major" to update package.json
    if (releaseType) {
      packageInfo.version = semver.inc(packageInfo.version, releaseType)
      fs.writeFileSync('package.json', JSON.stringify(packageInfo))
      await git((cmd) => {
        cmd.add('package.json')
        cmd.commit('-m "version bump"')
      })
    }
    // publish a new release on npm. Update version in package.json!
    const version = packageInfo.version
    await this.docs()
    await this.def()
    await this.publishSite()
    await git((cmd) => {
      cmd.pull()
      cmd.tag(version)
      cmd.push('origin 3.x --tags')
    })
    await exec('rm -rf docs/wiki/.git')
    await exec('npm publish')
    console.log('-- RELEASED --')
  },

  async versioning() {
    const semver = require('semver')

    if (fs.existsSync('./package.json')) {
      const packageFile = require('./package.json')
      const currentVersion = packageFile.version
      let type = process.argv[3]
      if (!['major', 'minor', 'patch'].includes(type)) {
        type = 'patch'
      }

      const newVersion = semver.inc(packageFile.version, type)
      packageFile.version = newVersion
      fs.writeFileSync('./package.json', JSON.stringify(packageFile, null, 2).replace(/(^[ \t]*\n)/gm, ''))
      console.log('Version updated', currentVersion, '=>', newVersion)

      const file = 'CHANGELOG.md'
      const changelog = fs.readFileSync(file).toString()

      const _changelog = `## ${newVersion}\n
❤️ Thanks all to those who contributed to make this release! ❤️

🛩️ *Features*

🐛 *Bug Fixes*

📖 *Documentation*

${changelog}`

      fs.writeFileSync(`./${file}`, _changelog)

      console.log('Creating and switching to release branch...')
      await exec(`git checkout -b release-${newVersion}`)
    }
  },

  async getCommitLog() {
    console.log('Gathering commits...')
    const logs = await exec(
      'git log --grep "chore(deps" --invert-grep --pretty=\'format:* %s - by @%aN\' $(git describe --abbrev=0 --tags)..HEAD | grep "DOC: " -v',
    )
    console.log(logs.data.stdout)
  },

  async contributorFaces() {
    // update contributors list in readme
    await contributors.update(null, { exclude: 'actions-user' })
    let readmeContent = fs.readFileSync('README.md')
    readmeContent = readmeContent
      .toString()
      .replace(
        '<a href="https://github.com/apps/dependabot"><img src="https://avatars.githubusercontent.com/in/29110?v=4" title="dependabot[bot]" width="80" height="80"></a>\n',
        '',
      )
    fs.writeFileSync('./README.md', readmeContent)
  },

  getCurrentBetaVersion() {
    try {
      const output = execSync('npm view codeceptjs versions --json').toString()
      const versions = JSON.parse(output)
      const betaVersions = versions.filter((version) => version.includes('beta'))
      const latestBeta = betaVersions.length ? betaVersions[betaVersions.length - 1] : null
      console.log(`Current beta version: ${latestBeta}`)
      return latestBeta
    } catch (error) {
      console.error('Error fetching package versions:', error)
      process.exit(1)
    }
  },

  publishNextBetaVersion() {
    const currentBetaVersion = this.getCurrentBetaVersion()
    if (!currentBetaVersion) {
      console.error('No beta version found.')
      process.exit(1)
    }

    const nextBetaVersion = semver.inc(currentBetaVersion, 'prerelease', 'beta')
    console.log(`Publishing version: ${nextBetaVersion}`)

    try {
      // Save original version
      const packageJson = JSON.parse(fs.readFileSync('package.json', 'utf8'))
      const originalVersion = packageJson.version
      execSync(`npm version ${nextBetaVersion} --no-git-tag-version`)
      execSync('npm publish --tag beta')
      console.log(`Successfully published ${nextBetaVersion}`)

      // Revert to original version
      execSync(`npm version ${originalVersion} --no-git-tag-version`)
      console.log(`Reverted back to original version: ${originalVersion}`)
    } catch (error) {
      console.error('Error publishing package:', error)
      process.exit(1)
    }
  },
}

async function processChangelog() {
  const file = 'CHANGELOG.md'
  let changelog = fs.readFileSync(file).toString()

  // user
  changelog = changelog.replace(/\s@([\w-]+)/gm, ' **[$1](https://github.com/$1)**')

  // issue
  changelog = changelog.replace(/#(\d+)/gm, '[#$1](https://github.com/codeceptjs/CodeceptJS/issues/$1)')

  // helper
  changelog = changelog.replace(/\s\[(\w+)\]\s/gm, ' **[$1]** ')

  writeToFile('docs/changelog.md', (cfg) => {
    cfg.line('---')
    cfg.line('permalink: /changelog')
    cfg.line('title: Releases')
    cfg.line('sidebar: false')
    cfg.line('layout: Section')
    cfg.line('---')
    cfg.line('')
    cfg.line('# Releases')
    cfg.line('')
    cfg.line(changelog)
  })
}

if (require.main === module) runok(module.exports)

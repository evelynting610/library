'use strict'
const fs = require('fs')
const md5 = require('md5')
const caller = require('caller')
const path = require('path')

const layoutsDir = path.join(__dirname, '../layouts')
exports.getTemplates = (subfolder) => {
  return (fs.readdirSync(path.join(layoutsDir, subfolder)) || [])
    .reduce((memo, filename) => {
      const [name] = filename.split('.')
      memo.add(name)
      return memo
    }, new Set())
}

// disable spreadsheets from being linked to directly for now
const supportedTypes = new Set(['folder', 'document', 'text/html']) //, 'spreadsheet'])
exports.isSupported = (resourceType) => {
  return supportedTypes.has(resourceType)
}

exports.sortDocs = (a, b) => {
  const hasFolder = a.resourceType === 'folder' || b.resourceType === 'folder'
  if (!hasFolder || a.resourceType === b.resourceType) {
    return a.sort.localeCompare(b.sort)
  }

  return b.resourceType === 'folder' ? 1 : -1
}

exports.getUserInfo = (req) => {
  // In development, use stub data
  if (process.env.NODE_ENV === 'development') {
    return {
      email: process.env.TEST_EMAIL || 'test.user@nytimes.com',
      userId: '10',
      analyticsUserId: md5('10library')
    }
  }

  return {
    email: req.headers['auth.verified_email'],
    userId: req.headers['auth.verified_sub'],
    analyticsUserId: md5(req.headers['auth.verified_sub'] + 'library')
  }
}

exports.requireWithFallback = (attemptPath, fallbackPath) => {
  const callFile = caller()
  const callingPath = callFile.substring(0, callFile.lastIndexOf('/'))

  try {
    console.log(path.join(callingPath, attemptPath));
    return require(path.join(callingPath, attemptPath))
  } catch (e) {
    console.log('falling back');
    return require(path.join(callingPath, fallbackPath))
  }
}

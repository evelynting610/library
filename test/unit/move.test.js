'use strict'

const {expect} = require('chai')
const {google} = require('googleapis')
const sinon = require('sinon')
const moment = require('moment')
// TODO: remove once cache is promisified
const {promisify} = require('util') 

const list = require('../../server/list')
const move = require('../../server/move')
const cache = require('../../server/cache')
const {page1} = require('../fixtures/driveListing')

const folderType = 'application/vnd.google-apps.folder'
const sampleFile = {
  fileId: page1.data.files.find((file) => file.mimeType !== folderType).id,
  destination: page1.data.files.find((file) => file.mimeType === folderType).id,
  html: '<html><h1>Test file </h1></html>'
}

let count = 0
const nextModified = () => {
  count += 1
  return moment(sampleFile.modified).add(count, 'days').format()
}
const updateFile = () => {}

describe('Move files', () => {
  describe('results from getFolders', async () => {
    let folders

    before(async () => {
      folders = await move.getFolders()
    })

    it('should return only folders', () => {
      const onlyFolders = folders[0].children
        .reduce((acc, val) => acc && list.getMeta(val.id).resourceType === 'folder', true)

      expect(onlyFolders).to.be.true // eslint-disable-line no-unused-expressions
    })

    it('should return a single object nested in an array', () => {
      expect(folders).to.be.an('array')
      expect(folders.length).to.equal(1)
      expect(folders[0]).to.be.an('object')
    })

    it('should specify the drive id on the top level', () => {
      expect(folders[0].id).to.equal(process.env.DRIVE_ID)
    })

    it('should specify a prettyName on the top level', () => {
      expect(folders[0].prettyName).to.be.a('string')
    })

    it('should contain children arrays', () => {
      expect(folders[0].children).to.be.an('array')
      expect(folders[0].children[0].children).to.be.an('array')
    })
  })

  describe('moveFile function', () => {
    const {fileId, destination, html} = sampleFile
    let path, newPath, updateSpy, newUrl

    before(async () => {
      const {path: oldPath, slug} = list.getMeta(fileId)
      path = `${oldPath}/${slug}`
      const {path: destPath} = list.getMeta(destination)
      newPath = `${destPath}/${slug}`

      const addToCache = promisify(cache.add)
      await addToCache(fileId, nextModified(), path, html)
    })

    beforeEach(async () => {
      updateSpy = sinon.spy(updateFile)
      google.drive = () => {
        return {
          files: {
            update: updateSpy
          }
        }
      }
    })

    after(async () => cache.purge({url: newUrl, modified: nextModified()}))

    describe('when not Google authenticated', () => {
      let oldAuth
      before(() => {
        oldAuth = google.auth.getApplicationDefault
        google.auth.getApplicationDefault = () => {
          return Promise.reject(Error('Auth error'))
        }
      })

      after(() => {
        google.auth.getApplicationDefault = oldAuth
      })

      it('should return an error', async () => {
        await move.moveFile('test')
          .catch((err) => {
            expect(err).to.exist.and.be.an.instanceOf(Error)
          })
      })
    })

    it('should return an error when the file has no parent folders', async () => {
      const result = await move.moveFile('fakeId', 'fakeDest')
      expect(result).to.exist.and.be.an.instanceOf(Error)
    })

    it('should return an error when the drive id is supplied as the file to move', async () => {
      const result = await move.moveFile(process.env.DRIVE_ID, 'fakeDest')
      expect(result).to.exist.and.be.an.instanceOf(Error)
    })

    describe('in team drive', () => {
      it('should use team drive options with drive api', async () => {
        newUrl = await move.moveFile(fileId, destination, 'team')

        const options = updateSpy.args[0][0]

        expect(options.corpora).to.equal('teamDrive')
        expect(options.teamDriveId).to.equal(process.env.DRIVE_ID)
        expect(options.fileId).to.equal(fileId)
      })
    })

    describe('in shared drive', () => {
      it('should use shared drive options with drive api', async () => {
        newUrl = await move.moveFile(fileId, destination, 'shared')
        const options = updateSpy.args[0][0]

        expect(updateSpy.calledOnce).to.be.true  // eslint-disable-line no-unused-expressions
        expect(options.teamDriveId).to.equal(undefined)
        expect(options.fileId).to.equal(fileId)
      })
    })

    describe('when trashing files', () => {
      let listStub
      before(() => {
        listStub = sinon.stub(list, 'getMeta')
        listStub.withArgs('trash').returns({path: '/trash'})
        listStub.callThrough()
      })

      after(() => {
        listStub.restore()
      })

      it('should redirect to home', async () => {
        newUrl = await move.moveFile(fileId, 'trash', 'shared')
        expect(newUrl).to.equal('/')
      })
    })

    describe('cache interaction', () => {
      describe('when specified file id has no associated html stored in cache', () => {
        let getCacheStub

        before(() => {
          getCacheStub = sinon.stub(cache, 'get')
          getCacheStub.callsFake((path, cb) => {
            cb(null, [{html: null}])
          })
        })

        after(() => {
          getCacheStub.restore()
        })

        it('should redirect to home', async () => {
          newUrl = await move.moveFile(fileId, destination, 'shared')
          expect(newUrl).to.equal('/')
        })
      })

      describe('when cache errors', () => {
        let addToCacheStub

        before(async () => {
          const addToCache = promisify(cache.add)
          await addToCache(fileId, nextModified(), path, html)

          addToCacheStub = sinon.stub(cache, 'add')
          addToCacheStub.callsFake((id, modified, newurl, html, cb) => cb(Error('Add to cache error')))
        })

        after(() => {
          addToCacheStub.restore()
        })

        it('should redirect to home', async () => {
          newUrl = await move.moveFile(fileId, destination, 'shared')
          expect(newUrl).to.equal('/')
        })
      })

      it('should return new url when new path is successfully added to cache', async () => {
        newUrl = await move.moveFile(fileId, destination)

        expect(newUrl).to.equal(newPath)
      })
    })
  })
})

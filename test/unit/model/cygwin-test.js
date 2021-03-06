'use strict';

import chai, { expect } from 'chai';
import sinon from 'sinon';
import { default as sinonChai } from 'sinon-chai';
import mockfs from 'mock-fs';
import fs from 'fs-extra';
import path from 'path';
import CygwinInstall from 'browser/model/cygwin';
import Logger from 'browser/services/logger';
import Util from 'browser/model/helpers/util';
import Platform from 'browser/services/platform';
import Downloader from 'browser/model/helpers/downloader';
import Installer from 'browser/model/helpers/installer';
import Hash from 'browser/model/helpers/hash';
import InstallableItem from 'browser/model/installable-item';
import InstallerDataService from 'browser/services/data';
import child_process from 'child_process';
import {ProgressState} from 'browser/pages/install/controller';
import loadMetadata from 'browser/services/metadata';
chai.use(sinonChai);

let reqs = loadMetadata(require('../../../requirements.json'), 'win32');

describe('Cygwin installer', function() {
  let installerDataSvc, sandbox, installer;
  let infoStub, errorStub, sha256Stub;
  let downloadUrl = 'https://cygwin.com/setup-x86_64.exe';
  let fakeInstallable = {
    isInstalled: function() { return false; }
  };

  installerDataSvc = sinon.stub(new InstallerDataService());
  installerDataSvc.getRequirementByName.returns(reqs.cygwin);
  installerDataSvc.getInstallable.returns(fakeInstallable);
  installerDataSvc.tempDir.returns('tempDirectory');
  installerDataSvc.installDir.returns('installationFolder');
  installerDataSvc.cygwinDir.returns('install/Cygwin');
  installerDataSvc.getInstallable.returns(fakeInstallable);
  installerDataSvc.localAppData.restore();

  let fakeProgress;

  let success = () => {};
  let failure = () => {};

  before(function() {
    infoStub = sinon.stub(Logger, 'info');
    errorStub = sinon.stub(Logger, 'error');
    sha256Stub = sinon.stub(Hash.prototype, 'SHA256').callsFake(function(file, cb) {
      cb('hash');
    });

    mockfs({
      tempDirectory: {},
      installationFolder: {}
    }, {
      createCwd: false,
      createTmp: false
    });
  });

  after(function() {
    mockfs.restore();
    infoStub.restore();
    errorStub.restore();
    sha256Stub.restore();
  });

  beforeEach(function () {
    installer = new CygwinInstall(installerDataSvc, 'cygwin', downloadUrl, 'cygwin.exe', 'sha');
    installer.ipcRenderer = { on: function() {} };
    sandbox = sinon.sandbox.create();
    fakeProgress = sandbox.stub(new ProgressState());
  });

  afterEach(function () {
    sandbox.restore();
  });

  it('should fail when no url is set and installed file not defined', function() {
    expect(function() {
      new CygwinInstall(installerDataSvc, null, null, null);
    }).to.throw('No download URL set');
  });

  it('should fail when no url is set and installed file is empty', function() {
    expect(function() {
      new CygwinInstall(installerDataSvc, null, null, '');
    }).to.throw('No download URL set');
  });

  it('should download cygwin installer to temporary folder as ssh-rsync.zip', function() {
    expect(new CygwinInstall(installerDataSvc, 'cygwin', 'url', 'cygwin.exe', 'sha').downloadedFile).to.equal(
      path.join(installerDataSvc.localAppData(), 'cache', 'cygwin.exe'));
  });

  describe('installer download', function() {
    let downloadStub;

    beforeEach(function() {
      downloadStub = sandbox.stub(Downloader.prototype, 'download').returns();
    });

    it('should write the data into temp/cygwin.exe', function() {
      installer.downloadInstaller(fakeProgress, success, failure);

      expect(downloadStub).to.have.been.calledOnce;
      expect(downloadStub).to.have.been.calledWith(downloadUrl, path.join(installerDataSvc.localAppData(), 'cache', 'cygwin.exe'));
    });

    it('should call a correct downloader request with the specified parameters once', function() {
      installer.downloadInstaller(fakeProgress, success, failure);

      expect(downloadStub).to.have.been.calledOnce;
      expect(downloadStub).to.have.been.calledWith(downloadUrl);
    });

    it('should skip download when the file is found in the download folder', function() {
      sandbox.stub(fs, 'existsSync').returns(true);

      installer.downloadInstaller(fakeProgress, success, failure);

      expect(downloadStub).not.called;
    });
  });

  describe('installation', function() {
    before(function() {
      installerDataSvc.getRequirementByName.returns(reqs.virtualbox);
    });

    after(function() {
      installerDataSvc.getRequirementByName.returns(reqs.cygwin);
    });

    it('should install once virtualbox has finished', function() {
      let stub = sandbox.stub(installer, 'installAfterRequirements').returns();
      sandbox.stub(fakeInstallable, 'isInstalled').returns(true);
      let item2 = new InstallableItem('virtualbox', 'url', 'installFile', 'targetFolderName', installerDataSvc);
      item2.setInstallComplete();
      item2.thenInstall(installer);
      installer.install(fakeProgress, success, failure);

      expect(stub).calledOnce;
    });

    it('should set progress to "Installing"', function() {
      sandbox.stub(Installer.prototype, 'exec').resolves(true);
      sandbox.stub(Installer.prototype, 'copyFile').resolves(true);
      sandbox.stub(Util, 'writeFile').resolves(true);
      sandbox.stub(Platform, 'addToUserPath').resolves(true);

      return installer.installAfterRequirements(fakeProgress, success, failure).then(() => {
        expect(fakeProgress.setStatus).to.have.been.calledOnce;
        expect(fakeProgress.setStatus).to.have.been.calledWith('Installing');
      });
    });

    it('should run the cygwin.exe installer with correct parameters', function() {
      sandbox.stub(Installer.prototype, 'exec').resolves(true);
      sandbox.stub(Installer.prototype, 'copyFile').resolves(true);
      sandbox.stub(Util, 'writeFile').resolves(true);
      sandbox.stub(Platform, 'addToUserPath').resolves(true);

      return installer.installAfterRequirements(fakeProgress, success, failure).then(()=>{
        expect(Installer.prototype.exec).to.have.been.calledWithMatch('powershell');
      });
    });

    it('should run the cygwin.exe installer with local packages if they present', function() {
      sandbox.stub(Installer.prototype, 'exec').resolves(true);
      sandbox.stub(Installer.prototype, 'copyFile').resolves(true);
      sandbox.stub(Util, 'writeFile').resolves(true);
      sandbox.stub(Platform, 'addToUserPath').resolves(true);
      sandbox.stub(fs, 'existsSync').returns(true);
      return installer.installAfterRequirements(fakeProgress, success, failure).then(()=>{
        expect(Installer.prototype.exec).to.have.been.calledWithMatch('powershell');
      });
    });

    it('should catch errors thrown during the installation', function() {
      let err = new Error('critical error');
      sandbox.stub(child_process, 'execFile').yields(err);
      let failure = sandbox.stub();
      return installer.installAfterRequirements(fakeProgress, success, failure).catch(()=>{
        expect(failure).to.be.calledOnce;
      });
    });

    it('should copy cygwin.exe installer in target directory', function(done) {
      sandbox.stub(Installer.prototype, 'exec').resolves(true);
      sandbox.stub(Installer.prototype, 'execFile').resolves(true);
      sandbox.stub(Installer.prototype, 'copyFile').resolves(true);
      sandbox.stub(Util, 'writeFile').resolves(true);
      sandbox.stub(Platform, 'addToUserPath').resolves(true);
      installer.installAfterRequirements(fakeProgress, function() {
        expect(Installer.prototype.copyFile).to.be.calledWith(
          installer.downloadedFile,
          path.join(installer.installerDataSvc.cygwinDir(), 'setup-x86_64.exe'));
        done();
      }, failure);
    });
  });

  describe('isDisabled', function() {
    it('returns true if not detected and required at least by one other selected installer', function() {
      if(installer.option.detected) {
        delete installer.option.detected;
      }
      installer.references = 1;
      expect(installer.isDisabled()).to.be.equal(true);
    });

    it('returns false if detected', function() {
      if(!installer.option.detected) {
        installer.addOption('detected', '2.8.1-1', '/location', true);
      }
      expect(installer.isDisabled()).to.be.equal(false);
      installer.references = 1;
      expect(installer.isDisabled()).to.be.equal(false);
    });
  });

  describe('detectExistingInstall', function() {
    describe('on macOS', function() {
      it('should mark cygwin as detected', function() {
        sandbox.stub(Platform, 'getOS').returns('darwin');
        installer = new CygwinInstall(installerDataSvc, 'cygwin', downloadUrl, 'cygwin.exe', 'sha');
        installer.detectExistingInstall();
        expect(installer.selectedOption).to.be.equal('detected');
        expect(installer.hasOption('detected')).to.be.equal(true);
      });
    });
    describe('on Linux', function() {
      it('should mark cygwin as detected', function() {
        sandbox.stub(Platform, 'getOS').returns('linux');
        installer = new CygwinInstall(installerDataSvc, 'cygwin', downloadUrl, 'cygwin.exe', 'sha');
        installer.detectExistingInstall();
        expect(installer.selectedOption).to.be.equal('detected');
        expect(installer.hasOption('detected')).to.be.equal(true);
      });
    });
    describe('on Windows', function() {
      it('should mark cygwin for installation cygwin is not installed', function() {
        sandbox.stub(Platform, 'getOS').returns('win32');
        sandbox.stub(Util, 'executeCommand').onFirstCall().returns(Promise.reject('cygcheck is not available'));
        installer = new CygwinInstall(installerDataSvc, 'cygwin', downloadUrl, 'cygwin.exe', 'sha');
        installer.ipcRenderer = { on: function() {} };
        installer.detectExistingInstall().then(()=> {
          expect(installer.selectedOption).to.be.equal('install');
          expect(installer.hasOption('install')).to.be.equal(true);
        });
      });

      it('should mark cygwin as detected when cygwin, openssh and rsync packages are installed', function() {
        sandbox.stub(Platform, 'getOS').returns('win32');
        sandbox.stub(Util, 'executeCommand').onFirstCall().returns(Promise.resolve(
          ['Cygwin Package Information',
            'Package              Version        Status',
            'cygwin               2.6.0-1        OK',
            'openssh              7.3p1-2        OK',
            'rsync                3.1.2-1        OK'
          ].join('\n')));
        Util.executeCommand.onSecondCall().returns('/path/to/cygwin');
        installer.detectExistingInstall().then(()=> {
          expect(installer.selectedOption).to.be.equal('detected');
          expect(installer.hasOption('detected')).to.be.equal(true);
        });
      });

      it('should mark cygwin for installation when any of cygwin, openssh, rsync packages is missing', function() {
        sandbox.stub(Platform, 'getOS').returns('win32');
        sandbox.stub(Util, 'executeCommand').onFirstCall().returns(Promise.resolve(
          ['Cygwin Package Information',
            'Package              Version        Status',
            'cygwin               2.6.0-1        OK',
            'openssh              7.3p1-2        OK'
          ].join('\n')));
        Util.executeCommand.onSecondCall().returns('/path/to/cygwin');
        installer = new CygwinInstall(installerDataSvc, 'cygwin', downloadUrl, 'cygwin.exe', 'sha');
        installer.ipcRenderer = { on: function() {} };
        installer.detectExistingInstall().then(()=> {
          expect(installer.selectedOption).to.be.equal('install');
          expect(installer.hasOption('install')).to.be.equal(true);
        });
      });

      it('should remove detected option and mark for installation in case detection ran agian an nothing detected', function() {
        sandbox.stub(Platform, 'getOS').returns('win32');
        sandbox.stub(Util, 'executeCommand').onFirstCall().returns(Promise.resolve(
          ['Cygwin Package Information',
            'Package              Version        Status',
            'cygwin               2.6.0-1        OK',
            'openssh              7.3p1-2        OK',
            'rsync                3.1.2-1        OK'
          ].join('\n')));
        Util.executeCommand.onSecondCall().returns('/path/to/cygwin');
        installer.detectExistingInstall().then(()=> {
          expect(installer.selectedOption).to.be.equal('detected');
          expect(installer.hasOption('detected')).to.be.equal(true);
          Util.executeCommand.rejects('no cygwin detected');
          return installer.detectExistingInstall();
        }).then(()=>{
          expect(installer.option['install']).to.not.equal(undefined);
          expect(installer.option['detected']).to.equal(undefined);
        });
      });
    });
  });
});

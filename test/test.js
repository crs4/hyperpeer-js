const chai = require('chai');
const Hyperpeer = require('../');
const expect = chai.expect;

const serverAddress = 'localhost:8080';
let hp = {};
let hp2 = {};
/**
 hp.onAny(function (event, value) {
   console.log(event + ': ' + JSON.stringify(value));
 });
 */

describe('hyperpeer', () => {
  afterEach((done) => {
    if (hp.readyState != Hyperpeer.states.CLOSED && typeof hp.close === 'function') hp.close();
    if (hp2.readyState != Hyperpeer.states.CLOSED && typeof hp2.close === 'function') hp2.close();
    done();
  })
  it('should emit an event when connected to the signaling server', function (done) { 
    hp = new Hyperpeer(serverAddress);
    expect(hp.readyState).to.equal(Hyperpeer.states.STARTING);
    hp.on('online', () => {
      expect(hp.readyState).to.equal(Hyperpeer.states.ONLINE);
      done();
    })
  })
  it('should get the list of connected peers when requested with correct details', function (done) {
    hp = new Hyperpeer(serverAddress, { id: 'id1', type: 'type1'});
    hp.on('online', () => { 
      hp2 = new Hyperpeer(serverAddress, { id: 'id2', type: 'type1' });
      hp2.on('online', () => {
        hp.getPeers()
        .then((peers) => {
          expect(peers).to.be.an.instanceof(Array);
          expect(peers).to.have.lengthOf(2);
          expect(peers[0]).to.include({ id: 'id1', type: 'type1' });
          expect(peers[1]).to.include({ id: 'id2', type: 'type1' });     
          done();
        })
        .catch(done)
      })
    })
  })
  it('should request a peer connection, accept an incoming connection and disconnect', function (done) {
    this.timeout(6000);
    hp = new Hyperpeer(serverAddress, { id: 'id1', type: 'type1' });
    
    hp.on('online', () => {
      hp2 = new Hyperpeer(serverAddress, { id: 'id2', type: 'type1' });
      hp2.on('connection', (message) => {
        expect(hp2.readyState).to.be.equal(Hyperpeer.states.CONNECTING);
        hp2.acceptConnection()
        .then(() => {
          expect(hp2.readyState).to.be.equal(Hyperpeer.states.CONNECTED);
        })
        .catch(done);
      });
      hp.on('error', done);
      hp2.on('error', done);
      hp2.on('online', () => {
        hp2.listenConnections()
        .then(() => {
          expect(hp2.readyState).to.be.equal(Hyperpeer.states.LISTENING);
          return hp.connectTo('id2');
        })
        .then(() => {
          expect(hp.readyState).to.be.equal(Hyperpeer.states.CONNECTED);
          return hp.disconnect()
        })
        .then(() => {
          expect(hp.readyState).to.be.equal(Hyperpeer.states.ONLINE);
          done();
        })
        .catch(done);
      })
    })
  })
  it('should exchange data with a remote peer', function (done) {
    hp = new Hyperpeer(serverAddress, { id: 'id1', type: 'type1' });
    hp.on('online', () => {
      hp2 = new Hyperpeer(serverAddress, { id: 'id2', type: 'type1' });
      hp.on('error', done);
      hp2.on('error', done);
      hp2.on('connection', hp2.acceptConnection);
      hp2.on('data', (data) => {
        expect(data.toString()).to.equal('hello');
        hp2.send({foo: 'bar'});
      })
      hp.on('data', (data) => {
        expect(data).to.include({ foo: 'bar'});
        hp.disconnect();
        done();
      })
      hp2.on('online', () => {
        hp2.listenConnections()
        .then(() => {
          return hp.connectTo('id2');
        })
        .then(() => {
          return hp.send('hello')
        })
        .catch(done);
      })
    })
  })
  it('should exchange video and audio with a remote peer', function(done) {
    this.timeout(10000);
    var video = document.createElement("video");
    video.setAttribute('autoplay', 'true');
    document.body.appendChild(video); 

    navigator.mediaDevices.getUserMedia({ video: true, audio: true })
    .then((stream) => {
      hp = new Hyperpeer(serverAddress, { 
        id: 'id1', 
        type: 'type1',
        //stream: stream,
        videoElement: video
      });
      hp.on('online', () => {
        hp2 = new Hyperpeer(serverAddress, { 
          id: 'id2', 
          type: 'type1',
          stream: stream,
          //videoElement: video
        });
        hp2.on('online', () => {
          hp2.listenConnections()
            .then(() => {
              return hp.connectTo('id2');
            })
            .catch(done);
        })
        hp.on('error', done);
        hp2.on('error', done);
        hp2.on('connection', hp2.acceptConnection);
        hp.on('stream', (stream) => {
          expect(stream).to.be.instanceOf(MediaStream);
        })
        video.addEventListener('play', function () {
          console.log('Playing video...');
          setTimeout(() => {
            hp.disconnect();
            document.body.removeChild(video); 
            done();
          }, 2000)
        }, false);
        
      })
    })
    .catch(done);
  })
})
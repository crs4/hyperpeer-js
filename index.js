const EventEmitter2 = require('eventemitter2').EventEmitter2;
const SimplePeer = require('simple-peer');

class HyperpeerError extends Error {
    constructor(code, message, data) {
        super(message + ': ' + JSON.stringify(data));
        this.name = 'HyperpeerError';
        this.code = code;
        this.msg = message;
        this.data = data;
    }
}

class SignalingError extends HyperpeerError {
    constructor(code, message, data) {
        super(code, message, data);
        this.name = 'SignalingError';
    }
}

class PeerConnectionError extends HyperpeerError {
    constructor(code, message, data) {
        super(code, message, data);
        this.name = 'PeerConnectionError';
    }
}

class Hyperpeer extends EventEmitter2 {
    constructor(serverAddress, options) {
        super({
			wildcard: true
        });
        if (!options) options = {};
        let type = options.type || 'browser';
        let url = `${serverAddress}/${type}`;
        if (options.id) url += '/' + options.id;
        if (options.key) url += '/' + options.key;

        this.ws = new WebSocket(url);
        this.readyState = Hyperpeer.states.STARTING;
        this.peerConnection = null;
        this.stream = options.stream;
        this.videoElement = options.videoElement;

        this._setWebsocketListeners();
        this._setSelfListeners();        
    }

    _setWebsocketListeners() {
        this.ws.onopen = () => {
            this.readyState = Hyperpeer.states.ONLINE;
            this.emit('online');
        }
        this.ws.onmessage = (event) => {
            let message;
            try {
                message = JSON.parse(event.data);
            } catch (e) {
                //console.error('Invalid JSON message: ' + event.data);
                this.emit('server.error', new SignalingError(3002, e.message, event.data));
                return;
            }
            const serverMessages = new Set(['error', 'status', 'peers']);
            if (serverMessages.has(message.type)) {
                this.emit('server.' + message.type, message);
            } else {
                this.emit('peer.signal', message);
            }
        }
        this.ws.onerror = (error) => {
            this.emit('server.error', error);
        }
        this.ws.onclose = (event) => {
            //console.log('WS closed, code: ' + event.code + ', reason: ' + event.reason);
            this.readyState = Hyperpeer.states.CLOSED;
            this.emit('close', event);
        }
    }

    _setSelfListeners() {
        this.on('server.status', (message) => {
            if (message.status === 'unpaired') {
                this.readyState = Hyperpeer.states.ONLINE;
                if (this.peerConnection) this.peerConnection.destroy();
            } else if (message.status === 'paired') {
                this.readyState = Hyperpeer.states.CONNECTING;
            }
        })
    }

    _send(message) {
        return new Promise((resolve, reject) => {
            if (this.ws.readyState != WebSocket.OPEN) {
                reject(new Error('Not connected to signaling server. Message not sent: ' + JSON.stringify(message)));
                return;
            }
            this.ws.send(JSON.stringify(message));
            resolve();
        })
    }

    _unpair() {
        return new Promise((resolve, reject) => {
            this._send({ type: 'unpair'}).catch(reject);
            this.once('server.status', (message) => {
                if (message.status === 'unpaired') {
                    resolve();
                }
            })
        })
    }

    close() {
        this.ws.close();
        if (this.peerConnection) {
            this.removeAllListeners('peer.*');
            this.peerConnection.destroy();
        }
    }

    getPeers() {
        return this._send({ type: 'listPeers' })
        .then(() => {
            return new Promise((resolve, reject) => {
                this.once('server.error', reject);
                this.once('server.peers', (message) => {
                    this.removeListener('server.error', reject);
                    resolve(message.peers);
                });
            })
        })
    }

    connectTo(remotePeerId) {
        if (this.readyState != Hyperpeer.states.ONLINE) {
            return Promise.reject(new Error('Current state is: ' + this.readyState + ', it should be ' + Hyperpeer.states.ONLINE));
        }
        return this._send({ type: 'pair', remotePeerId: remotePeerId })
            .then(() => {
                return new Promise((resolve, reject) => {
                    this.once('server.error', reject);
                    this.once('server.status', (message) => {
                        this.removeListener('server.error', reject);
                        if (message.status != 'paired') {
                            reject(new SignalingError(null, 'Cannot pair with peer!'));
                            return;
                        }
                        resolve(this._negotiate());
                    });
                })
            })
    }

    acceptConnection() {
        if (this.readyState != Hyperpeer.states.CONNECTING) {
            return Promise.reject(new Error('Current state is: ' + this.readyState + ', it should be ' + Hyperpeer.states.CONNECTING));
        }        
        return this._negotiate(true);
    }

    listenConnections() {
        if (this.readyState != Hyperpeer.states.ONLINE) {
            return Promise.reject(new Error('Current state is: ' + this.readyState + ', it should be ' + Hyperpeer.states.ONLINE));
        }
        this.readyState = Hyperpeer.states.LISTENING;
        this.once('server.status', (message) => {
            if (message.status === 'paired') {
                this.emit('connection', { remotePeerId: message.remotePeerId });
            } 
        })
        return Promise.resolve();
    }

    disconnect() {
        return new Promise((resolve, reject) => {
            if (this.readyState != Hyperpeer.states.CONNECTED) {
                return reject(new Error('Current state is: ' + this.readyState + ', it should be ' + Hyperpeer.states.CONNECTED));
            }
            this.readyState = Hyperpeer.states.DISCONNECTING;
            this._unpair()
            .then(() => {
                this.peerConnection.destroy();
            })
            .catch(reject);
            this.on('disconnect', resolve);
        })
    }

    send(data) {
        if (this.readyState != Hyperpeer.states.CONNECTED) {
            return Promise.reject(new Error('Current state is: ' + this.readyState + ', it should be ' + Hyperpeer.states.CONNECTED));
        } 
        this.peerConnection.send(JSON.stringify(data));
        return Promise.resolve();
    }

    _negotiate(initiator) {
        return new Promise((resolve, reject) => {
            this.peerConnection = new SimplePeer({
                initiator: initiator,
                stream: this.stream
            });

            const timeout = initiator ? 5000 : 10000;
            const timeoutId = setTimeout(() => {
                console.error('Peer connection timeout!');
                this.removeAllListeners('peer.*');
                this.peerConnection.destroy();
                this.readyState = Hyperpeer.states.DISCONNECTING;
                if (this.readyState === Hyperpeer.states.CONNECTING) {
                    reject(new Error('timeout'));
                } else if (this.readyState === Hyperpeer.states.CONNECTED) {
                    this.emit('error', new PeerConnectionError('ERR_TIMEOUT', 'timeout'));
                }
            }, timeout);
    
            this.peerConnection.on('error', (error) => {
                if (this.readyState === Hyperpeer.states.CONNECTING) {
                    reject(error);
                } else {
                    this.readyState = Hyperpeer.states.DISCONNECTING;           
                    this.peerConnection.destroy();      
                    this.emit('error', error);   
                }
            });
    
            this.peerConnection.on('connect', () => {
                this.emit('connect');
                clearTimeout(timeoutId);
                this.readyState = Hyperpeer.states.CONNECTED;
                resolve();
            });
    
            this.peerConnection.on('signal', (signal) => {
                //console.log('****** Sending signal: ', signal);
                this._send(signal);
            });

            this.on('peer.signal', (message) => {
                //console.log('****** Receiving signal: ', message);
                this.peerConnection.signal(message);
            });
    
            this.peerConnection.on('data', (data) => {
                let msg
                try {
                    msg = JSON.parse(data);
                } catch(e) {
                    this.emit('error', 'Received a message with invalid format: ' + e.toString());
                    return;
                }
                this.emit('data', msg);
            });

            this.peerConnection.on('close', () => {
                this.emit('disconnect');
                this.removeAllListeners('peer.*');
                clearTimeout(timeoutId);
                this.peerConnection = null;
            });
    
            this.peerConnection.on('stream', (stream) => {
                // got remote video stream, now let's show it in a video tag
                if (this.videoElement) this.videoElement.srcObject = stream;
                this.emit('stream', stream);
            });

        })
    }
} 

Hyperpeer.states = {
    STARTING: 'starting', // connecting to signaling server
    ONLINE: 'online', // connected to signaling server but not paired to any peer
    CONNECTING: 'connecting', // pairing and establishing a webrtc connection with peer
    CONNECTED: 'connected', // webrtc peer connection and data channel are ready
    DISCONNECTING: 'disconnecting', // closing peer connection
    CLOSING: 'closing', // disconnecting from signaling server
    CLOSED: 'closed', // disconnected from signaling server and not longer usable
    LISTENING: 'listening' // waiting for incoming connections
}
module.exports = Hyperpeer;
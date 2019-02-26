const EventEmitter2 = require('eventemitter2').EventEmitter2;
const SimplePeer = require('simple-peer');

/**
 *
 *
 * @class HyperpeerError
 * @extends {Error}
 * @private
 */
class HyperpeerError extends Error {
    constructor(code, message, data) {
        if (data) {
            message += JSON.stringify(data)
        }
        super(message);
        this.name = 'HyperpeerError';
        this.code = code;
        this.msg = message;
        this.data = data;
    }
}

/**
 *
 *
 * @class SignalingError
 * @extends {HyperpeerError}
 * @private
 */
class SignalingError extends HyperpeerError {
    constructor(code, message, data) {
        super(code, message, data);
        this.name = 'SignalingError';
    }
}

/**
 *
 *
 * @class PeerConnectionError
 * @extends {HyperpeerError}
 * @private
 */
class PeerConnectionError extends HyperpeerError {
    constructor(code, message, data) {
        super(code, message, data);
        this.name = 'PeerConnectionError';
    }
}

/**
 * An instance of the Hyperpeer class is an {@link https://www.npmjs.com/package/eventemitter2|EventEmitter} that represents the local peer in a WebRTC application based in Hyperpeer.
 * Hyperpeer instances manages both the connection with the signaling server and the peer-to-peer communication via WebRTC with remote peers.
 *
 * @class Hyperpeer
 * @extends {EventEmitter2}
 * @param {string} serverAddress - URL of the Hyperpeer signaling server, it should include the protocol prefix 'ws://' or 'wss//' that specify the websocket protocol to use. 
 * @param {Object} options - Peer settings
 * @param {string} [options.type=browser] - Peer type. It can be used by other peers to know the role of the peer in the current application.
 * @param {string=} options.id - Peer unique identification string. Must be unique among all connected peers. If it's undefined or null, the server will assign a random string.
 * @param {string=} options.key - Peer validation string. It may be used by the server to verify the peer.
 * @param {Object=} options.videoElement - Video tag element that will be used as sink of the incoming media stream.
 * @param {Object=} options.stream - {@link https://developer.mozilla.org/en-US/docs/Web/API/MediaStream|MediaStream} object that will be sent to the remote peer.
 * @param {Object=} options.datachannelOptions - A {@link https://developer.mozilla.org/en-US/docs/Web/API/RTCPeerConnection/createDataChannel#RTCDataChannelInit_dictionary|RTCDataChannelInit dictionary} providing configuration options for the data channel.
 * @param {number=} [options.connectionTimeout=15] - Timeout in seconds for canceling a connection request.
 * @emits Hyperpeer#online
 * @emits Hyperpeer#error
 * @emits Hyperpeer#close
 * @emits Hyperpeer#connection
 * @emits Hyperpeer#disconnection
 * @emits Hyperpeer#connect
 * @emits Hyperpeer#disconnect
 * @emits Hyperpeer#stream
 * @emits Hyperpeer#data
 */
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

        /**
         * State of the peer instance. It may have one of the values specified in {@link Hyperpeer#states|Hyperpeer.states}
         * @member {string}
         * @readonly
         */
        this.readyState = Hyperpeer.states.STARTING;

        this.peerConnection = null;
        this.stream = options.stream;
        this.videoElement = options.videoElement;
        this.datachannelOptions = options.datachannelOptions
        this.connectionTimeout = options.connectionTimeout || 15 // 15 seconds timeout

        this._setWebsocketListeners();
        this._setSelfListeners();        
    }

    /**
     * Set websocket listeners
     *
     * @memberof Hyperpeer
     * @private
     */
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
                this.emit('error', new SignalingError('ERR_BAD_SIGNAL', e.message, event.data));
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
            this.emit('error', new SignalingError('ERR_WS_ERROR', error.message, error));
        }
        this.ws.onclose = (event) => {
            //console.log('WS closed, code: ' + event.code + ', reason: ' + event.reason);
            this.readyState = Hyperpeer.states.CLOSED;
            this.emit('close', 'WS closed, code: ' + event.code + ', reason: ' + event.reason);
        }
    }

    /**
     * Some self listeners
     *
     * @memberof Hyperpeer
     * @private
     */
    _setSelfListeners() {
        this.on('server.status', (message) => {
            if (message.status === 'unpaired') {
                if (this.readyState === Hyperpeer.states.CONNECTED || this.readyState === Hyperpeer.states.CONNECTING) {
                    this.emit('disconnection')
                } 
            } else if (message.status === 'paired') {
                // Pairing is expected when listening or starting a connection
                if (this.readyState === Hyperpeer.states.LISTENING || this.readyState === Hyperpeer.states.CONNECTING) {
                    this.readyState = Hyperpeer.states.CONNECTING;
                    this.emit('connection', { remotePeerId: message.remotePeerId })
                } else {
                    // If pairing was not expected then rejects connection (unpair) immediately
                    this._unpair()
                }
            }
        })
        this.on('disconnect', () => {
            this.readyState = Hyperpeer.states.ONLINE
        })
        this.on('connect', () => {
            this.readyState = Hyperpeer.states.CONNECTED
        })
        this.on('disconnection', () => {
            if (!this.peerConnection) {
                this.readyState = Hyperpeer.states.ONLINE
            }
        })
    }

    /**
     * Send messages to the signaling server.
     *
     * @param {*} message
     * @returns {Promise}
     * @memberof Hyperpeer
     * @private
     */
    _send(message) {
        return new Promise((resolve, reject) => {
            if (this.ws.readyState != WebSocket.OPEN) {
                reject(new SignalingError('ERR_WS_ERROR', 'Not connected to signaling server. Message not sent: ' + JSON.stringify(message)));
                return;
            }
            this.ws.send(JSON.stringify(message));
            resolve();
        })
    }

    /**
     * Send unpair command to the signaling server.
     *
     * @returns {Promise}
     * @memberof Hyperpeer
     * @private
     */
    _unpair() {
        return new Promise((resolve, reject) => {
            this._send({ type: 'unpair'}).catch(reject)
            this.once('server.status', (message) => {
                if (message.status === 'unpaired') {
                    resolve()
                } else {
                    reject(new SignalingError('ERR_SIGNAL_ERR', 'Cannot unpair!'))
                }
            })
        })
    }

    /**
     * Close the connection with the signaling server and with any remote peer.
     *
     * @memberof Hyperpeer
     */
    close() {
        this.ws.close();
        if (this.peerConnection) {
            this.removeAllListeners('peer.*');
            this.peerConnection.destroy();
        }
    }

    /**
     * Returns a promise that resolve with the list of peers currently connected to the signaling server.
     *
     * @returns {Promise<Hyperpeer~peer[]>}
     * @memberof Hyperpeer
     */
    getPeers() {
        return this._send({ type: 'listPeers' })
        .then(() => {
            return new Promise((resolve, reject) => {
                this.once('error', reject);
                this.once('server.peers', (message) => {
                    this.removeListener('error', reject);
                    resolve(message.peers);
                });
            })
        })
    }

    /**
     * Request a peer-to-peer connection with a remote peer. 
     *
     * @param {string} remotePeerId - id of the remote peer to connect to. 
     * @returns {Promise} 
     * @memberof Hyperpeer
     */
    connectTo(remotePeerId) {
        if (this.readyState != Hyperpeer.states.ONLINE) {
            return Promise.reject(new HyperpeerError('ERR_BAD_STATE', 'Current state is: ' + this.readyState + ', it should be ' + Hyperpeer.states.ONLINE))
        }
        return this._send({ type: 'pair', remotePeerId: remotePeerId })
            .then(() => {
                return new Promise((resolve, reject) => {
                    this.readyState = Hyperpeer.states.CONNECTING
                    this.once('error', reject);
                    this.once('connection', () => {
                        this.removeListener('error', reject)
                        resolve(this._negotiate())
                    })
                })
            })
    }

    /**
     * Accept an incoming connection from a remote peer. You should call to the {@link Hyperpeer#listenConnections|listenConnections()} method first.
     *
     * @returns {Promise}
     * @memberof Hyperpeer
     */
    acceptConnection() {
        if (this.readyState != Hyperpeer.states.CONNECTING) {
            return Promise.reject(new HyperpeerError('ERR_BAD_STATE', 'Current state is: ' + this.readyState + ', it should be ' + Hyperpeer.states.CONNECTING));
        }        
        return this._negotiate(true);
    }

    /**
     * Wait for incoming connections.
     *
     * @returns {Promise}
     * @memberof Hyperpeer
     */
    listenConnections() {
        if (this.readyState != Hyperpeer.states.ONLINE) {
            return Promise.reject(new HyperpeerError('ERR_BAD_STATE', 'Current state is: ' + this.readyState + ', it should be ' + Hyperpeer.states.ONLINE));
        }
        this.readyState = Hyperpeer.states.LISTENING;
        return Promise.resolve();
    }

    /**
     * Drop the current connection with the remote peer.
     *
     * @returns {Promise}
     * @memberof Hyperpeer
     */
    disconnect() {
        return new Promise((resolve, reject) => {
            if (this.readyState != Hyperpeer.states.CONNECTED && this.readyState != Hyperpeer.states.CONNECTING) {
                return resolve();
            }
            this._unpair()
            .then(() => {
                if (this.peerConnection) {
                    this.once('disconnect', resolve)
                } else {
                    this.emit('disconnect')
                    resolve()
                }
            })
            .catch(reject)
        })
    }

    /**
     * Send a message to the connected remote peer using the established WebRTC data channel.
     *
     * @param {*} data
     * @returns {Promise}
     * @memberof Hyperpeer
     */
    send(data) {
        if (this.readyState != Hyperpeer.states.CONNECTED) {
            return Promise.reject(new HyperpeerError('ERR_BAD_STATE', 'Current state is: ' + this.readyState + ', it should be ' + Hyperpeer.states.CONNECTED));
        } 
        this.peerConnection.send(JSON.stringify(data));
        return Promise.resolve();
    }

    /**
     *
     *
     * @param {*} initiator
     * @returns {Promise}
     * @memberof Hyperpeer
     * @private
     */
    _negotiate(initiator) {
        return new Promise((resolve, reject) => {
            this.peerConnection = new SimplePeer({
                initiator: initiator,
                stream: this.stream,
                channelConfig: this.datachannelOptions
            })

            const timeout = initiator ? 5000 : this.connectionTimeout * 1000
            const timeoutId = setTimeout(() => {
                this.removeAllListeners('peer.*')
                if (this.readyState === Hyperpeer.states.CONNECTING) {
                    this.disconnect()
                } else if (this.readyState === Hyperpeer.states.CONNECTED) {
                    this.emit('error', new PeerConnectionError('ERR_TIMEOUT', 'timeout'))
                    this.disconnect()
                }
            }, timeout)
    
            this.peerConnection.on('error', (error) => {
                if (this.readyState === Hyperpeer.states.CONNECTING) {
                    reject(new PeerConnectionError('ERR_WEBRTC_ERROR', error.message, error))
                } else {     
                    this.emit('error', new PeerConnectionError('ERR_WEBRTC_ERROR', error.message, error))
                }
                this.disconnect()
            })

            this.once('disconnection', () => {
                if (this.readyState === Hyperpeer.states.CONNECTING) {
                    reject(new PeerConnectionError('ERR_CONNECTION_REFUSED', 'Connection refused or canceled'))
                } 
                this.readyState = Hyperpeer.states.DISCONNECTING
                this.peerConnection.destroy()
            })
    
            this.peerConnection.on('connect', () => {
                this.emit('connect')
                clearTimeout(timeoutId)
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
                    this.emit('error', new PeerConnectionError('ERR_BAD_MESSAGE', 'Received a message with invalid format: ' + e.toString()));
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
/**
 * Possible values of readyState
 * @name states
 * @enum {string}
 * @property {string} STARTING - connecting to signaling server
 * @property {string} ONLINE - connected to signaling server but not paired to any peer
 * @property {string} CONNECTING - pairing and establishing a WebRTC connection with peer
 * @property {string} CONNECTED - WebRTC peer connection and data channel are ready
 * @property {string} DISCONNECTING - closing peer connection
 * @property {string} LISTENING - waiting for incoming connections
 * @property {string} CLOSING - disconnecting from signaling server
 * @property {string} CLOSED - disconnected from signaling server and not longer usable
 * @readonly
 * @memberof Hyperpeer
 */
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
/**
 * Element of the list of peers.
 * @typedef {Object} Hyperpeer~peer
 * @property {string} id - id of the peer.
 * @property {string} type - type of the peer.
 * @property {boolean} busy - Indicates whether the peer is paired and comunicating with another peer.
 */
/**
 * Online event. Emitted when successfully connected to the signaling server.
 *
 * @event Hyperpeer#online
 */
/**
 * Error event.
 *
 * @event Hyperpeer#error
 * @property {object} error - Error object.
 */
/**
 * Close event. Emitted when disconnected from the signaling server.
 *
 * @event Hyperpeer#close
 */
/**
 * Connection event. Emitted when a connection request is received. If {@link Hyperpeer#listenConnections|listenConnections()} 
 * was called, then {@link Hyperpeer#acceptConnection|acceptConnection()} should be called to proceed with the 
 * establishment of the peer-to-peer connection. If {@link Hyperpeer#connectTo|connectTo()} was called, then
 * the establishment of the peer-to-peer connection begins immediately after this event.
 *
 * @event Hyperpeer#connection
 * @property {object} details
 * @property {string} details.remotePeerId - id of the remote peer that request the connection.
 */
/**
 * Disconnection event. Emitted when the peer-to-peer connection is refused or canceled. This event indicates that the
 * peer-to-peer connection is being closed. Listen to the {@link Hyperpeer#disconnect|disconnect} event to know when the WebRTC connection
 * is truly closed.
 *
 * @event Hyperpeer#disconnection
 */
/**
 * Connect event. Emitted when a WebRTC connection is successfully established with the remote peer.
 *
 * @event Hyperpeer#connect
 */
/**
 * Disconnect event. Emitted when disconnected from the remote peer and the WebRTC connection is closed.
 *
 * @event Hyperpeer#disconnect
 */
/**
 * Stream event. Emitted when a {@link https://developer.mozilla.org/en-US/docs/Web/API/MediaStream|MediaStream} is received from the remote peer.
 *
 * @event Hyperpeer#stream
 * @property {object} - {@link https://developer.mozilla.org/en-US/docs/Web/API/MediaStream|MediaStream} object
 */
/**
 * Data event. Emitted when a data channel message is received from the remote peer.
 *
 * @event Hyperpeer#data
 * @property {*} - Data
 */
module.exports = Hyperpeer;
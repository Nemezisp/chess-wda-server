const express = require('express');
const socketIo = require("socket.io");
const cors = require('cors');
const path = require('path');
const compression = require('compression')

const port = process.env.PORT || 5000;

const app = express();
app.use(compression())
const server = app.listen(port);
const io = socketIo.listen(server);

let users = {};
let gameNumber = 1;
let rooms = [];
let timers = {};

app.use(cors())

let getRandomInt = (max) => {
    return Math.floor(Math.random() * Math.floor(max))+1;
}

let milisecondsToTime = (miliseconds) => {
    let currentTimeMinutes = String(Math.floor(miliseconds/60000))
    let currentTimeSeconds = String(miliseconds%60000/1000)
    if (currentTimeSeconds < 10) {
        currentTimeSeconds = '0' + currentTimeSeconds
    }
    return currentTimeMinutes + ':' + currentTimeSeconds
}

let startTimer = (id) => {
    timers[id] = setInterval(() => {
        users[id].time = users[id].time - 100
        if (users[id].time%1000 === 0){
            let currentTime = milisecondsToTime(users[id].time)
            io.to(users[id].currentRoom).emit('changeTime', currentTime, id)
        }
        if (users[id].time === 0) {
            stopTimer(id)
            io.to(users[id].currentRoom).emit('timeEnded', id)
        }
    }, 100)
}

let stopTimer = (id) => {
    clearInterval(timers[id])
}

io.on('connection', (client) => {
    client.on('registration', (username, armyName, pieceNames, prefferedTime) => {
        users[client.id] = {'username': username, 'army': armyName, 'pieces' : pieceNames, 'inPlay' : false, 'id' : client.id,
                            'prefferedTime' : prefferedTime}
        io.to(client.id).emit('register', client.id, username, prefferedTime)
        io.emit('updateUsers', Object.values(users))
    })

    client.on('disconnect', () => {
        if (users[client.id]) {
            if (users[client.id].currentRoom) {
                client.to(users[client.id].currentRoom).emit('userLeftGame')
                if (users[users[client.id].opponentId]){
                    users[users[client.id].opponentId].opponentId = null
                    stopTimer(users[client.id].opponentId)
                }
            }
            stopTimer(client.id)
            delete users[client.id]
            io.emit('updateUsers', Object.values(users))

        }
    })

    client.on('initiateStartGame', id => {
        rooms.push('room' + gameNumber)
        gameNumber += 1
        io.sockets.connected[id].join(rooms[rooms.length-1]);
        io.sockets.connected[client.id].join(rooms[rooms.length-1]);

        users[id].playerNumber = getRandomInt(2)
        users[client.id].playerNumber = users[id].playerNumber === 1 ? 2 : 1
        users[id].time = users[id].prefferedTime
        users[client.id].time = users[id].prefferedTime
        users[id].opponentId = client.id
        users[client.id].opponentId = id
        users[id].currentRoom = rooms[rooms.length-1]
        users[client.id].currentRoom = rooms[rooms.length-1]
        users[id].inPlay = true
        users[client.id].inPlay = true

        let firstPlayerPieces = users[id].pieces.map(piece => piece.replace(/\s/g, "").toLowerCase())
        let secondPlayerPieces = users[client.id].pieces.map(piece => piece.replace(/\s/g, "").toLowerCase())

        io.to(client.id).emit('startGame', users[client.id].playerNumber, firstPlayerPieces, users[id].username)
        io.to(id).emit('startGame', users[id].playerNumber, secondPlayerPieces, users[client.id].username)

        io.to(client.id).emit('setStartingTime', milisecondsToTime(users[client.id].time))
        io.to(id).emit('setStartingTime', milisecondsToTime(users[id].time))

        io.emit('updateUsers', Object.values(users))

        let firstPlayerId = users[id].playerNumber === 1 ? id : client.id
        startTimer(firstPlayerId)
    })

    client.on('move', (startSquare, finalSquare) => {
        stopTimer(client.id)
        client.to(users[client.id].currentRoom).emit('move', startSquare, finalSquare)
        startTimer(users[client.id].opponentId)
    })

    client.on('castling', (rookStartSquare, rookEndSquare, kingStartSquare, kingEndSquare) => {
        stopTimer(client.id)
        client.to(users[client.id].currentRoom).emit('castling', rookStartSquare, rookEndSquare, kingStartSquare, kingEndSquare)
        startTimer(users[client.id].opponentId)
    })

    client.on('enpassant', (startSquare, endSquare, pawnToRemoveSquare) => {
        stopTimer(client.id)
        client.to(users[client.id].currentRoom).emit('enpassant', startSquare, endSquare, pawnToRemoveSquare)
        startTimer(users[client.id].opponentId)
    })

    client.on('promotion', (start, target, piece) => {
        stopTimer(client.id)
        client.to(users[client.id].currentRoom).emit('promotion', start, target, piece)
        startTimer(users[client.id].opponentId)
    })

    client.on('changePlayer', () => {
        client.to(users[client.id].currentRoom).emit('changePlayer')
    })

    client.on('addPreviousMove', (pieceSymbol, startSquare, finalSquare) => {
        client.to(users[client.id].currentRoom).emit('addPreviousMove', pieceSymbol, startSquare, finalSquare)
    })

    client.on('resign', gameResult => {
        client.to(users[client.id].currentRoom).emit('resign', gameResult)
        users[client.id].gameEnded = true
        users[users[client.id].opponentId].gameEnded = true
        stopTimer(client.id)
        stopTimer(users[client.id].opponentId)
    })

    client.on('drawOffer', () => {
        client.to(users[client.id].currentRoom).emit('drawOffer')
    })

    client.on('gameEnded', () => {
        users[client.id].gameEnded = true
        users[users[client.id].opponentId].gameEnded = true
    })

    client.on('drawOfferAccepted', () => {
        client.to(users[client.id].currentRoom).emit('drawOfferAccepted')
        stopTimer(client.id)
        stopTimer(users[client.id].opponentId)
        users[users[client.id].opponentId].gameEnded = true
        users[client.id].gameEnded = true
    })

    client.on('leaveGame', () => {
        let gameEnded = users[users[client.id].opponentId] ? users[users[client.id].opponentId].gameEnded : true
        client.to(users[client.id].currentRoom).emit('userLeftGame', gameEnded)
        stopTimer(client.id)
        stopTimer(users[client.id].opponentId)
        io.sockets.connected[client.id].leave(users[client.id].currentRoom)
        users[client.id].time = null
        users[client.id].inPlay = false
        users[client.id].currentRoom = null
        users[client.id].playerNumber = null
        users[client.id].gameEnded = false
        if (users[client.id].opponentId) {
            users[users[client.id].opponentId].opponentId = null
        }
        users[client.id].opponentId = null

        io.emit('updateUsers', Object.values(users))
    })
})
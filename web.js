import { createAimServer } from './server.js'

const port = Number(process.env.PORT || 3000)
const server = createAimServer()
server.listen(port, '127.0.0.1', () => {
  console.log('AIM for Ollama is listening at http://127.0.0.1:' + server.address().port)
})

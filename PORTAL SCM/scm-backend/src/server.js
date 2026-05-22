const express = require('express');
const cors = require('cors');

require('dotenv').config();

const authRoutes = require('./routes/auth.routes');
const clientesRoutes = require('./routes/clientes.routes');
const comprovantesRoutes = require('./routes/comprovantes.routes');
const usuariosRoutes = require('./routes/usuarios.routes');
const planilhasRoutes = require('./routes/planilhas.routes');

const app = express();

app.use(cors());
app.use(express.json());

app.get('/', (req, res) => {
  res.json({
    mensagem: 'Backend SCM rodando com sucesso!',
  });
});

app.use('/api/auth', authRoutes);
app.use('/api/clientes', clientesRoutes);
app.use('/api/comprovantes', comprovantesRoutes);
app.use('/api/usuarios', usuariosRoutes);
app.use('/api/planilhas', planilhasRoutes);

const PORT = process.env.PORT || 3001;

app.listen(PORT, () => {
  console.log(`Servidor rodando em http://localhost:${PORT}`);
});
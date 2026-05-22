const jwt = require('jsonwebtoken');

function autenticarToken(req, res, next) {
  const authHeader = req.headers.authorization;

  if (!authHeader) {
    return res.status(401).json({
      mensagem: 'Token não informado.',
    });
  }

  const partes = authHeader.split(' ');

  if (partes.length !== 2 || partes[0] !== 'Bearer') {
    return res.status(401).json({
      mensagem: 'Formato do token inválido.',
    });
  }

  const token = partes[1];

  try {
    const usuario = jwt.verify(token, process.env.JWT_SECRET);
    req.user = usuario;
    next();
  } catch (error) {
    return res.status(401).json({
      mensagem: 'Token inválido ou expirado.',
    });
  }
}

function autorizarRoles(...rolesPermitidas) {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({
        mensagem: 'Usuário não autenticado.',
      });
    }

    if (!rolesPermitidas.includes(req.user.role)) {
      return res.status(403).json({
        mensagem: 'Você não tem permissão para acessar este recurso.',
      });
    }

    next();
  };
}

module.exports = {
  autenticarToken,
  autorizarRoles,
};
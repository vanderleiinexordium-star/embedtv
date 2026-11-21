# Embedtv — catálogo M3U Plus

## O que foi atualizado
- O site deixou de consultar a API antiga `embedtv.cc`.
- A função `netlify/functions/iptv.js` lê a playlist no servidor e interpreta `group-title`, `tvg-logo`, nome e URL.
- O catálogo oferece categorias, busca, paginação e favoritos locais no navegador.
- A playlist e as credenciais não ficam dentro do repositório.

## Configuração no Netlify
Em **Site configuration → Environment variables**, configure:
- `IPTV_USERNAME`: usuário fornecido pelo seu serviço de playlist.
- `IPTV_PASSWORD`: senha fornecida pelo seu serviço de playlist.

Depois faça um novo deploy do repositório.

## Endpoints
- `/.netlify/functions/iptv?action=categories`
- `/.netlify/functions/iptv?action=channels&page=1&limit=60`
- `/.netlify/functions/iptv?action=channels&category=Nome%20da%20categoria&page=1&limit=60`

## Atenção ao tamanho da playlist
A playlist enviada tem aproximadamente 99 MB. A função mantém uma cópia em memória por até cinco minutos por instância, mas uma instância fria precisa baixar e percorrer a playlist. Dependendo do tempo de resposta do provedor e dos limites do plano Netlify, isso pode exceder o tempo permitido para uma Function. Se ocorrer timeout, a solução correta é colocar a playlist em armazenamento/serviço de catálogo apropriado e paginar a leitura a partir dele; não publique a playlist inteira no repositório GitHub.

## Publicação e acesso
O site foi configurado para catálogo público, conforme solicitado. Como a reprodução é pública, os endereços dos streams retornados ao navegador podem ser vistos pelos visitantes. Use somente conteúdo que você tenha autorização para distribuir publicamente.

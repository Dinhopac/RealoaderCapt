# RealoaderCapt
🛡️ ReloaderCapt Pro (v3.3)
Extensão avançada (Manifest V3) para Auto-Reload em Background e Monitoramento Inteligente de Elementos, Links, Cores e Cards, combinando os melhores recursos do AutoRefresh.io e do Distill Web Monitor.

________________________________________
✨ Principais Recursos
1. 🔄 Motor de Auto-Reload & Escudo Anti-Bloqueio
-	Contagem Real em Background (nextReloadAt): Continua recarregando as abas monitoradas mesmo com o Popup fechado ou em segundo plano.
-	Variação Humana (Jitter ±25%) & Intervalo Aleatório (Mín/Máx): Evita bloqueios de firewall (WAF/Cloudflare) variando o tempo entre cada ciclo.
-	Modo Silencioso (Stealth DOM Check): Opção para verificar alterações no HTML em segundo plano sem piscar a tela com F5.
-	Auto-Cooldown (Captcha / Erro 429): Detecta telas de bloqueio e desacelera automaticamente para proteger o IP.
2. 🎯 Barra Acumuladora Multi-Alvos (CSS, XPath, Links, Cores e Cards)
-	Captura Visual Point-and-Click: Ao passar o mouse na página, identifica a Tag HTML, o Seletor CSS único, o XPath, atributos <a href>, arquivos (.xls, .xlsx, .pdf), a Cor Visual (RGB) e a contagem de Cards.
-	Acúmulo Múltiplo na Barra: Permite clicar em vários elementos diferentes na página (ou digitar termos/links e clicar em ➕) para vigiar múltiplos aspectos simultaneamente.
3. 🎨 4 Modos de Detecção Contínua
-	🔍 Palavra / Link Aparecer (found): Dispara quando o texto, link href ou extensão aparece na área vigiada.
-	🚫 Palavra / Link Sumir (lost): Dispara quando o termo ou elemento deixa de existir na página.
-	🎨 Mudança de Cor no Elemento (color_change): Detecta automaticamente se um indicador de status mudou de cor (ex: de Verde para Vermelho/Amarelo).
-	🗂️ Quadro / Slide Alterar Cards (cards_change): Vigia listas, grades ou carrosséis e alerta quando os cards sofrem alteração.
4. 🔊 Sintetizador de Áudio Integrado (Web Audio API)
6 opções de alerta sonoro geradas nativamente sem dependência de arquivos externos:

-	🔔 Sino Cristalino (Padrão)
-	🚨 Sirene de Emergência
-	📡 Sonar / Radar Militar
-	👾 8-Bit Arcade (Retrô)
-	⚠️ Bip Triplo Urgente
-	🔇 Silencioso (Apenas Alerta Visual)
5. 📊 Painel de Monitoramento em Colunas (Dashboard)
-	Visão Kanban em 3 Colunas (Em Monitoramento Ativo, Alertas Detectados, Pausados) e Visão Tabela Completa (Watchlist).
-	KPIs em Tempo Real: Total de elementos capturados, abas ativas, alertas e soma de ciclos.
-	Backup Completo: Exportação e Importação de monitoramentos em formato .JSON.

________________________________________
⌨️ Atalhos de Teclado
-	Alt + Shift + R: Recarregar a aba atual imediatamente.
-	Alt + Shift + A: Ativar ou pausar o monitoramento na aba atual.
-	ESC: Fechar a barra acumuladora de captura na página.

________________________________________
📁 Estrutura do Projeto
ReloaderCapt/
├── manifest.json       # Configuração Manifest V3
├── icon.png            # Ícone oficial da extensão
├── popup.html          # Interface Mini-Player & Abas recolhíveis
├── dashboard.html      # Painel de Monitoramento em Colunas
├── css/
│   ├── button.css      # Estilos da pílula, janela flutuante e captura
│   └── dashboard.css   # Estilos do Painel em Colunas e Watchlist
└── js/
    ├── background.js   # Service Worker, relógio central e selo (Badge) por aba
    ├── content.js      # Capturador multi-alvos, inspetor de cor/cards e sintetizador de som
    ├── popup.js        # Controle sincronizado do Mini-Player e configurações
    └── dashboard.js    # Gerenciamento em colunas e exportação/importação JSON


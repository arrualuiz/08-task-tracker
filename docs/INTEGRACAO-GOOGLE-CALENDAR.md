# Integração local com Google Calendar

## O que está pronto

A aba **Calendários**, em http://localhost:3210/calendarios, consulta eventos reais depois que cada conta autoriza o site. **Meu dia** e **Revisão de rotinas** continuam em páginas separadas. Calendários não criam tarefas no planejamento automaticamente.

É possível conectar várias contas do mesmo usuário, listar seus calendários, escolher quais consultar, filtrar por conta, buscar nos eventos carregados e consultar até 31 dias por vez. O período inclui a data final. A primeira seleção marca o calendário principal de cada conta; os demais podem ser marcados manualmente. Cada consulta aceita até 20 calendários.

Eventos de dia inteiro conservam as datas originais; o término exclusivo do Google é apresentado como último dia incluído. Eventos com horário são exibidos em UTC−03:00. A API Google expande as recorrências e aplica as exceções; eventos cancelados não são exibidos. Se uma conta/calendário falhar, a página identifica a consulta como incompleta, mantendo os resultados que conseguiu obter.

## Configurar pela primeira vez

1. Abra a aba **Calendários** e expanda **Configurar integração com o Google**. Os links na página levam ao Google Cloud.
2. Crie ou selecione um projeto e ative a **Google Calendar API**. Se usar o projeto da integração Apps Script antiga, confirme que é um projeto Cloud que você consegue administrar; a URL do Apps Script e seu token não substituem um cliente OAuth.
3. Configure o **Google Auth Platform**: nome do app, e-mail de suporte, contato e público. Para contas pessoais, use público externo em teste e adicione cada e-mail que deseja conectar aos **Usuários de teste**. Contas organizacionais podem depender das regras do administrador.
4. Em **Clientes**, crie um cliente OAuth do tipo **Aplicativo da Web**. Configure o URI de redirecionamento autorizado mostrado na página. No endereço padrão é exatamente:

   `http://localhost:3210/oauth/google/callback`

5. Baixe o JSON do cliente, selecione-o no formulário local e clique em **Salvar configuração local**. Não coloque esse JSON na pasta pública nem faça commit dele. O arquivo deve ter a propriedade `web`, com o ID, segredo e URIs do cliente.
6. Clique em **Conectar conta Google**, escolha a conta e autorize a leitura da lista de calendários e de seus eventos. O site também pede identificação básica e e-mail para relacionar a autorização à conta correta.
7. Ao retornar, selecione calendários, escolha o período e clique em **Consultar eventos**. Repita **Conectar conta Google** para adicionar outra conta.

O usuário precisa concluir a autenticação e a autorização no Google. A conexão do Google em uma conversa com o assistente é independente desta autorização do site. Não compartilhe senhas ou tokens na conversa.

## Erros comuns

- **redirect_uri_mismatch:** use o endereço exato da página de configuração. `localhost` e `127.0.0.1` são diferentes. Se mudar porta ou endereço, atualize o cliente no Google e baixe novamente o JSON. Com contas conectadas, desconecte-as antes de trocar a configuração local.
- **Acesso bloqueado / app em teste:** confirme público, usuários de teste, API ativada e eventuais restrições da conta organizacional. Não contorne bloqueios do navegador ou da organização.
- **Permissão insuficiente:** conecte novamente e autorize os dois acessos de leitura solicitados.
- **Autorização expirada ou revogada:** conecte a conta novamente. Em projetos externos no estado Testing, autorizações com estes escopos podem exigir reconexão após sete dias.
- **Sem eventos:** confira seleção, conta e período. Isso é diferente de erro; falhas aparecem como consulta incompleta.

## Persistência, identidade e limites

- `dados-locais/google-private.sqlite` guarda o cliente OAuth e as autorizações, fora do Git, da pasta pública e do backup de planejamento. Os segredos ficam no disco local e dependem das permissões/proteção do computador; não há criptografia adicional implementada neste arquivo.
- O navegador recebe somente o estado de configuração e os rótulos/IDs das contas, calendários e eventos. Tokens não são devolvidos pelas APIs públicas locais. O JSON de configuração transita apenas do formulário ao servidor local.
- O callback usa estado aleatório, cookie HttpOnly/SameSite, validade de dez minutos, uso único e PKCE. Ao terminar, redireciona para uma URL sem o código de autorização.
- A identidade da conta vem do `sub` Google autenticado. Eventos são relacionados por `(accountId, calendarId, eventId)`; nomes/títulos não são identidades. A mesma conta reconectada atualiza sua autorização sem duplicá-la.
- A renovação do token é feita no servidor. Consultas simultâneas da mesma conta compartilham uma renovação em andamento. Respostas atrasadas não recriam contas desconectadas.
- **Desconectar deste site** remove a autorização armazenada localmente. Não exclui eventos e não revoga automaticamente o consentimento no Google; para revogar também lá, use [Conexões da Conta Google](https://myaccount.google.com/connections).
- Os eventos são consultados ao solicitar a atualização e ficam apenas em memória para exibição. Não existe cache persistente, atualização em tempo real, sincronização de escrita ou envio automático para Meu dia.
- Paginação é percorrida, com proteção contra páginas repetidas e consultas excessivas. Não há limite silencioso de resultados: uma consulta interrompida aparece como falha daquele calendário.
- O servidor continua limitado a loopback. Publicação e iPhone exigem uma etapa de hospedagem, autenticação do site e armazenamento seguro de credenciais. A credencial fixa do Apps Script anterior ainda precisa de migração/rotação antes da publicação; não é reutilizada nesta integração.

## Validação

`npm run check` valida a sintaxe. `npm test` usa bancos temporários e um transporte Google simulado para verificar configuração, estado/cookie OAuth, expiração, escopos, reconexão, renovação, múltiplas contas, paginação, recorrências, datas, falhas parciais e isolamento das credenciais. Nenhum teste cria, altera, conclui ou exclui eventos/tarefas reais.

A conexão real depende das credenciais e do consentimento do usuário e deve ser validada depois desses passos. iCloud, sincronização Google Tasks/Sheets e bloqueio de horários no Google permanecem planejados.

## Referências oficiais consultadas

- [OAuth para aplicações web](https://developers.google.com/identity/protocols/oauth2/web-server): cliente web, URI de retorno, consentimento, estado e renovação.
- [Lista de calendários](https://developers.google.com/workspace/calendar/api/v3/reference/calendarList/list): escopo de leitura e paginação.
- [Lista de eventos](https://developers.google.com/workspace/calendar/api/v3/reference/events/list): período, recorrências expandidas e paginação.
- [Expiração de tokens em projetos de teste](https://developers.google.com/identity/protocols/oauth2#expiration): limites de autorizações no estado Testing.

# Print Agent 2.0 - Ponte de Impressão Universal

![Licença](https://img.shields.io/badge/licen%C3%A7a-MIT-blue.svg)
![Versão](https://img.shields.io/badge/vers%C3%A3o-2.0.0-brightgreen.svg)

Um agente de impressão local que cria uma ponte entre aplicações web/mobile e impressoras térmicas (ou de recibos) conectadas via USB, permitindo a impressão direta através de uma API REST simples.

---

## Índice

- [O Problema](#o-problema)
- [A Solução](#a-solução)
- [Funcionalidades](#funcionalidades)
- [Para o Usuário Final](#para-o-usuário-final)
  - [Instalação](#instalação)
- [Para Desenvolvedores](#para-desenvolvedores)
  - [Pré-requisitos](#pré-requisitos)
  - [Configuração do Ambiente](#configuração-do-ambiente)
  - [Como Gerar o Instalador](#como-gerar-o-instalador)
- [Documentação da API](#documentação-da-api)
  - [`GET /status`](#get-status)
  - [`GET /printers`](#get-printers)
  - [`POST /print/raw-buffer`](#post-printraw-buffer)
- [Tecnologias Utilizadas](#tecnologias-utilizadas)
- [Licença](#licença)

## O Problema

Aplicações web modernas, por questões de segurança (sandboxing), não possuem acesso direto ao hardware do cliente, como portas USB. Isso torna a tarefa de imprimir um cupom ou recibo em uma impressora térmica local um grande desafio, geralmente exigindo que o usuário passe pela caixa de diálogo de impressão do sistema, que é inadequada para impressão de recibos.

## A Solução

O **Print Agent** é um pequeno servidor Node.js que roda silenciosamente na máquina do usuário (onde a impressora está conectada). Ele expõe uma API REST local que sua aplicação web pode consumir para:

1.  Verificar se o agente está online.
2.  Listar as impressoras USB conectadas.
3.  Enviar comandos de impressão brutos (como ESC/POS) diretamente para uma impressora específica.

A aplicação web faz uma chamada `fetch` para `http://localhost:9100`, e o agente se encarrega de traduzir essa chamada em uma operação de hardware real.

## Funcionalidades

-   ✅ **API RESTful:** Interface simples e conhecida para integração.
-   ✅ **Autodetecção de Impressoras:** Lista automaticamente as impressoras ESC/POS conectadas via USB.
-   ✅ **Impressão Direta:** Envia buffers de dados brutos (Base64) para a impressora, permitindo total controle sobre o formato (textos, códigos de barras, QR codes, imagens, etc.).
-   ✅ **Operação Silenciosa:** Roda em segundo plano ao iniciar o Windows, sem nenhuma janela visível para o usuário.
-   ✅ **Instalador Simples:** Um único arquivo `.exe` que configura tudo automaticamente.

## Para o Usuário Final

### Instalação

1.  Vá para a seção de **Releases** do repositório.
2.  Baixe o arquivo `PrintAgent-2.0-Setup.exe` mais recente.
3.  Execute o instalador e siga os passos.

Após a instalação, o programa será iniciado automaticamente toda vez que o computador for ligado. Nenhuma outra ação é necessária.

## Para Desenvolvedores

### Pré-requisitos

Para compilar e desenvolver este projeto, você precisará ter instalado:

-   [Node.js](https://nodejs.org/) (versão 20.x ou superior)
-   [Inno Setup](https://jrsoftware.org/isinfo.php) (para gerar o instalador)

### Configuração do Ambiente

```bash
# Clone o repositório
git clone [https://github.com/SEU_USUARIO/SEU_REPOSITORIO.git](https://github.com/SEU_USUARIO/SEU_REPOSITORIO.git)

# Entre na pasta do projeto
cd print-agent-2.0

# Instale as dependências
npm install
```
Como Gerar o Instalador
O instalador é a forma final de distribuição. Ele empacota o Node.js, seu script e as dependências.

Prepare os node_modules: Garanta que você tenha apenas as dependências de produção.

```Bash

npm install --omit=dev
```
Prepare os arquivos principais: Certifique-se de que os seguintes arquivos estão na raiz do projeto:

node.exe (copiado da sua pasta de instalação do Node.js)

server.js (seu código principal, na versão limpa e original)

start-silent.vbs (o script para inicialização silenciosa)

Compile o script do Inno Setup:

Abra o programa "Inno Setup Compiler".

Vá em "File" -> "Open..." e selecione o arquivo setup.iss.

Clique em "Compile".

O arquivo PrintAgent-2.0-Setup.exe final será gerado na pasta Output.

## Documentação da API

O agente escuta em `http://localhost:9100`.

### `GET /status`

Verifica se o agente está online.

-   **Resposta de Sucesso (200 OK):**
    ```json
    {
      "status": "online",
      "message": "Print Agent (Modo Ponte Universal) está rodando."
    }
    ```

### `GET /printers`

Lista as impressoras USB compatíveis conectadas.

-   **Resposta de Sucesso (200 OK):**
    ```json
    [
      {
        "type": "usb",
        "name": "EPSON TM-T20X",
        "manufacturer": "EPSON",
        "vid": "0x4b8",
        "pid": "0xe2e",
        "deviceAddress": 1
      },
      {
        "type": "usb",
        "name": "Generic POS Printer",
        "manufacturer": "Unknown",
        "vid": "0x1fc9",
        "pid": "0x2016",
        "deviceAddress": 2
      }
    ]
    ```

### `POST /print/raw-buffer`

Envia um buffer de dados brutos (comandos ESC/POS) para uma impressora específica.

-   **Headers:**
    - `Content-Type: application/json`
-   **Corpo da Requisição (Body):**
    ```json
    {
      "printer": {
        "type": "usb",
        "vid": "0x4b8",
        "pid": "0xe2e"
      },
      "bufferB64": "GxhVABx0ZXN0ZSBkZSBpbXByZXNzYW8uLi4KCgoKVgA="
    }
    ```
    Para impressoras de rede compativeis com RAW/JetDirect, envie o IP/host da impressora. A porta padrao e `9100`:

    ```json
    {
      "printer": {
        "type": "network",
        "host": "192.168.0.50",
        "port": 9100
      },
      "bufferB64": "GxhVABx0ZXN0ZSBkZSBpbXByZXNzYW8uLi4KCgoKVgA="
    }
    ```
    - `printer`: Objeto identificando a impressora (use os `vid` e `pid` obtidos em `/printers`).
    - `bufferB64`: String em Base64 contendo os comandos de impressão.

-   **Resposta de Sucesso (200 OK):**
    ```json
    {
      "success": true,
      "message": "Dados brutos enviados para a impressora."
    }
    ```

### Cadastro local de impressoras de rede

As impressoras de rede cadastradas ficam em `C:\ProgramData\PrintAgent\printers.json` no Windows. Para testar usando outro diretorio, inicie o agente com a variavel `PRINT_AGENT_DATA_DIR`.

#### `GET /printers/network/scan`

Procura impressoras de rede compativeis com RAW/JetDirect testando a porta `9100`.

```http
GET /printers/network/scan
GET /printers/network/scan?subnet=192.168.0.0/24
GET /printers/network/scan?subnet=192.168.0&timeoutMs=500
```

#### `POST /printers/network`

Salva uma impressora de rede no cadastro local.

```json
{
  "name": "Caixa 01",
  "host": "192.168.0.50",
  "port": 9100
}
```

#### `DELETE /printers/network/:id`

Remove uma impressora de rede cadastrada.

Tambem e possivel imprimir usando o `id` de uma impressora de rede cadastrada:

```json
{
  "printerId": "network-192-168-0-50-9100",
  "bufferB64": "GxhVABx0ZXN0ZSBkZSBpbXByZXNzYW8uLi4KCgoKVgA="
}
```

## Tecnologias Utilizadas

-   [Node.js](https://nodejs.org/) - Ambiente de execução
-   [Express.js](https://expressjs.com/) - Framework para o servidor web
-   [node-escpos](https://github.com/song940/node-escpos) - Biblioteca para comunicação com impressoras ESC/POS
-   [Inno Setup](https://jrsoftware.org/isinfo.php) - Ferramenta para criação do instalador para Windows

## Licença

Este projeto está sob a licença MIT. Veja o arquivo `LICENSE` para mais detalhes.


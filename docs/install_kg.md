# How to create a knowlege graph and wire it to Devin/Claude Code/Cursor

---

## **Step 1: Install and Initialize CodeGraph Locally**

CodeGraph requires Node 22 or higher to utilize native SQLite bindings without extra compilers. Run these initial setup commands in your project root directory: [1]

```bash
# 1. Install CodeGraph globally
npm install -g @colbymchenry/codegraph

# 2. Verify native backend installation
codegraph status

# 3. Create your repository knowledge graph interactively
codegraph init -i

# 4. Generate the graph index (creates the .codegraph/ index directory)
codegraph index

```

*(Note: If you run code edits later, CodeGraph tracks file changes and auto-syncs incrementally.)* [4, 5]

---

## **Step 2: Configure CodeGraph for Your 3 Coding Agents**

## **1. Setup for Claude Code**

[CodeGraph](https://github.com/colbymchenry/codegraph) includes an automated installer specifically built to inject its MCP capabilities directly into Claude Code's configuration. 

- 

- Run the native linking installer:
  ```bash
  codegraph install

  ```
- This command automatically writes the execution pathway to your agent configuration, enabling tools like `codegraph_explore` inside Claude Code.
- **Verification**: Fire up Claude Code (`claude`) inside your project directory. It will detect the graph and read the index parameters natively. 
- 

## **2. Setup for Cursor IDE**

Cursor interfaces with the knowledge graph using an MCP connection and system rule hints to ensure the agent uses the database before resorting to full-text searches. [

- 

- **Add the MCP Server**:
  1. Open Cursor and navigate to **Settings** $\rightarrow$ **Features** $\rightarrow$ **MCP**.
  2. Click **+ Add New MCP Server**.
  3. Set **Name** to `codegraph`.
  4. Set **Type** to `command`.
  5. Set **Command** to `codegraph mcp`.
- **Add AI Navigation System Rules**:  
To prevent Composer or Chat from ignoring the graph, create a file named `.cursor/rules/codegraph.md` at your project root to align Cursor's exploration patterns:
  ```markdown
  # CodeGraph Rules
  - Before running widespread file grep or file reading commands, use the `codegraph` tools.
  - Rely on `codegraph_explore` to assess symbol interactions, callers, and class inheritance.
  - Rely on the graph's returned snippets as already read. Do not double-verify via grep.

  ```



## 3. Setup for Devin Desktop

Devin Desktop exposes a global Model Context Protocol (MCP) daemon alongside dedicated workspace navigation files to route local indexing queries directly into Devin Local (Cascade).

- Configure the MCP Server:  
Devin Desktop parses a core mcp.json file to identify available system plugins. Add the tool to your global editor settings profile file:
- Mac/Linux Path: ~/.codeium/windsurf/mcp.json (or ~/.config/devin/config.json)
  - Windows Path: %USERPROFILE%codeium\windsurf\mcp.json (or %APPDATA%\devin\config.json)  
  Add or append the following schema to the file:

```
{
  "mcpServers": {
    "codegraph": {
      "command": "codegraph",
      "args": ["mcp"],
      "env": {}
    }
  }
}
```

- Alternative (CLI Configuration):  
If your workflow utilizes the devin shell, run this shorthand mapping in your project root terminal to instantly attach the tool:
```
devin mcp add codegraph -- codegraph mcp
```
- Add Agent Navigation Instructions:  
To force Devin Desktop's chat window to search the graph database before performing slow string matches across your code layer, create a workspace configuration file under .devin/rules/navigation.md:
```
This codebase contains a structured CodeGraph index under the `.codegraph/` folder. 
Before executing commands to crawl or inspect files via generic shell commands, 
execute terminal queries using the local CLI tool: `codegraph query "<symbol>"` 
or `codegraph trace <caller>` to map file paths instantly.
```

## **3. Setup for Devin**

Because Devin operates via a sandboxed browser/terminal container, you need to expose your local CodeGraph index directly to Devin's workspace machine. 

- 

- **Option A: Initialization Script (Recommended)**  
Devin relies heavily on startup routines. In your project repository, create a setup file called `.devin/setup.sh` or include these commands at the beginning of Devin's workspace instructions:
  ```bash
  # Instruct Devin to initialize CodeGraph inside its sandbox environment
  npm install -g @colbymchenry/codegraph
  codegraph init
  codegraph index

  ```
   [17, 18]
- **Option B: Prompt Injection Instruction**  
When spinning up a new Devin session, paste this playbook snippet into Devin's initial prompt interface:
  ```text
  This codebase contains a structured CodeGraph index under the `.codegraph/` folder. 
  Before executing commands to crawl or inspect files via generic shell commands, 
  execute terminal queries using the local CLI tool: `codegraph query "<symbol>"` 
  or `codegraph trace <caller>` to map file paths instantly.

  ```
- 

---

## **Step 3: Test and Validate the Graph**

Once configured, you can test if your agents are using the graph properly. Ask any of the 3 assistants a structural question that full-text `grep` usually fails to resolve accurately: 

> *"Trace the entire execution path and list the files touched when a user triggers validation on the registration form."*

**What to look for**: Instead of watching the agent trigger dozens of sequential file reads or global string searches, you should see it make **one targeted tool call** (`codegraph_explore`) to pull the exact dependencies and structural pathways needed.

Are you running into any **sandbox or permission limits** while linking the global node path inside Devin's machine environment?
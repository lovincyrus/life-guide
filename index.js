import express from "express";
import bodyParser from "body-parser";
import OpenAI from "openai";
import { z } from "zod";
import Instructor from "@instructor-ai/instructor";

import dotenv from "dotenv";
dotenv.config();

const app = express();
const port = 3000;

app.use(bodyParser.json());

const OptionSchema = z.object({
  title: z.string().describe("The title of the action item"),
  description: z.string().describe("The description of the action item."),
  percentageOfSuccess: z.number().int().describe("The percentage of success"),
  pros: z.array(z.string()).describe("The pros of the action item"),
  cons: z.array(z.string()).describe("The cons of the action item"),
});

const IssueSchema = z.object({
  task: z.string().describe("The task of the issue"),
  description: z.string().describe("The description of the issue."),
  priority: z.string().describe("The priority of the issue"),
  deadline: z.string().describe("The deadline of the issue"),
  potentialBlockers: z
    .array(z.string())
    .describe("The potential blockers of the issue"),
});

const ProjectSchema = z.object({
  projectName: z.string().describe("The name of the project"),
  projectDescription: z
    .string()
    .describe("The description of the project. Be specific."),
  options: z.array(OptionSchema).describe("The options to choose from"),
});

const IssuesSchema = z.object({
  projectName: z.string().describe("The name of the project"),
  projectDescription: z
    .string()
    .describe("The description of the project. Be specific."),
  actionItems: z
    .array(IssueSchema)
    .describe("The action items of the selected option"),
});

function generateUUID() {
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, function (c) {
    var r = (Math.random() * 16) | 0,
      v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

const client = Instructor({
  client: openai,
  mode: "FUNCTIONS",
});

const chatHistory = {};

function addMessagesToChatHistory(chatId, messages) {
  if (!chatHistory[chatId]) {
    chatHistory[chatId] = [];
  }
  // Append new messages to the existing chat history
  chatHistory[chatId].push(...messages);
}

function getChatHistory(chatId) {
  return chatHistory[chatId] || [];
}

async function createChatCompletions(
  now,
  then,
  selectedOption = null,
  previousMessages = [],
  chatId = generateUUID()
) {
  try {
    // Ensure chatId exists or is generated
    if (!chatId) {
      chatId = generateUUID();
    }

    // Start with the previous messages if any
    const messages = [...previousMessages];

    // If there are no previous messages, initialize the chat with system and user messages
    if (messages.length === 0) {
      messages.push(
        {
          role: "system",
          content:
            "You are a life coach and you can help users with their life problems. You understand the user's options, research for them, calculate the best path forward, estimate % based on the end goals, label the % on top of the options and help them make a decision. \n" +
            "User will provide where they are and where they want to be. \n" +
            "You will show me the options to choose from. \n" +
            "Wait for [SELECTED_OPTION]. Do not proceed until a selected option is provided. \n",
        },
        {
          role: "user",
          content: `[NOW] ${now}\n[THEN] ${then}`,
        }
      );
    }

    // TODO: If 'auto' is selected, we can use the AI to select the best option
    if (selectedOption) {
      messages.push({
        role: "assistant",
        content:
          "Create a project name, project description and action items for the [SELECTED_OPTION]. \n",
      });

      messages.push({
        role: "user",
        content: `[SELECTED_OPTION] ${selectedOption}`,
      });
    }

    const data = await client.chat.completions.create({
      model: "gpt-3.5-turbo",
      response_model: {
        schema: selectedOption ? IssuesSchema : ProjectSchema,
        name: selectedOption ? "Issues" : "Project",
      },
      messages: messages,
    });

    // After receiving the data, update the chat history with the new messages
    addMessagesToChatHistory(chatId, messages);

    return {
      data,
      id: chatId,
    };
  } catch (error) {
    console.error("Error creating chat completions:", error);
    throw error; // Rethrow or handle as needed
  }
}

app.get("/", (req, res) => {
  res.send({ ok: true });
});

app.post("/ask", async (req, res) => {
  const { now, then } = req.body;

  try {
    const data = await createChatCompletions(now, then);
    res.json({ data });
  } catch (error) {
    res.status(500).send("Failed to create chat completions");
  }
});

app.post("/select-option", async (req, res) => {
  const { selectedOption, chatId } = req.body;

  try {
    const previousMessages = getChatHistory(chatId);

    // Extract 'now' and 'then' from the previousMessages
    let now = "",
      then = "";
    previousMessages.forEach((message) => {
      if (message.role === "user") {
        const matchNow = message.content.match(/\[NOW\] (.*)\n/);
        const matchThen = message.content.match(/\[THEN\] (.*)/);
        if (matchNow) now = matchNow[1];
        if (matchThen) then = matchThen[1];
      }
    });

    if (!now || !then) {
      return res.status(400).send("Missing 'now' or 'then' in chat history.");
    }

    const data = await createChatCompletions(
      now,
      then,
      selectedOption,
      previousMessages,
      chatId
    );

    addMessagesToChatHistory(chatId, [
      { role: "user", content: `[SELECTED_OPTION] ${selectedOption}` },
    ]);

    res.json({ data });
  } catch (error) {
    res
      .status(500)
      .send("Failed to create chat completions with selected option");
  }
});

app.listen(port, () => {
  console.log(`Server running at http://localhost:${port}`);
});

// TODO: once we have the data, we can tell them the selectedOption and then create the project and action items

// console.log(data);

// const CREATE_PROJECT_MUTATION = `
//   mutation {
//     projectCreate(
//           input: {
//               name: "${data.projectName}",
//               description: "${data.projectDescription}",
//               teamIds: ["${process.env.TEAM_ID}"]
//           }
//       ) {
//           success
//           project {
//               id
//               name
//           }
//       }
//   }
// `;

// const createdProject = await fetch("https://api.linear.app/graphql", {
//   method: "POST",
//   headers: {
//     "Content-Type": "application/json",
//     Authorization: `${process.env["LINEAR_API_KEY"]}`,
//   },
//   body: JSON.stringify({ query: CREATE_PROJECT_MUTATION }),
// })
//   .then((response) => response.json())
//   .then((data) => {
//     console.log(
//       "Created project",
//       data.data.projectCreate.project.id,
//       data.data.projectCreate.project.name
//     );
//     const project = data.data.projectCreate.project;
//     return project;
//   })
//   .catch((error) => console.error("Error:", error));

// data.actionItems.forEach(async (actionItem) => {
//   const CREATE_ISSUE_MUTATION = `
//     mutation {
//         issueCreate(
//             input: {
//                 title: "${actionItem.title}",
//                 description: "${actionItem.description}",
//                 projectId: "${createdProject.id}",
//                 teamId: "${process.env.TEAM_ID}"
//                 stateId: "${process.env.BACKLOG_STATE_ID}"
//             }
//         ) {
//             success
//             issue {
//                 id
//                 title
//             }
//         }
//     }
//     `;

//   await fetch("https://api.linear.app/graphql", {
//     method: "POST",
//     headers: {
//       "Content-Type": "application/json",
//       Authorization: `${process.env["LINEAR_API_KEY"]}`,
//     },
//     body: JSON.stringify({ query: CREATE_ISSUE_MUTATION }),
//   })
//     .then((response) => response.json())
//     .then((data) => {
//       console.log(
//         "Created issue",
//         data.data.issueCreate.issue.id,
//         data.data.issueCreate.issue.title
//       );
//     })
//     .catch((error) => console.error("Error:", error));
// });

# Notes app
This document describes the requirements and use cases for an
application for easily keeping key=value notes.

## Requirements

### Access
- Must store data in the cloud so that it can be accessed from anywhere
- Must be able to use an Android phone app to list/get/set notes
- Must be able to use a desktop Ubuntu app
- Must be able to use a web-based app from anywhere

### Domain
- Similar to a JSON object
- Must support a tree of keys, similar to a registry or directories
- Each key can have key=value pairs and key=subtree keys

### Operations
- List keys at a level (like "ls")
- Drill down a level (like "cd")
- Get value for a key at this level
- Update value for that key
- Add a new key=value pair
- Add a new subtree (like "mkdir")
- Rename a key=value pair or subtree
- Move a key=value pair or subtree to another subtree
- Copy a key=value pair or subtree to another subtree
- Delete a key=value pair or subtree

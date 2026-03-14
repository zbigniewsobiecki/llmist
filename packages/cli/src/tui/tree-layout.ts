import type { BlockNode } from "./types.js";

export type TreeNodeVisitor = (nodeId: string, node: BlockNode, top: number) => number;

export function traverseNodeTree(
  nodeId: string,
  getNode: (id: string) => BlockNode | undefined,
  visit: TreeNodeVisitor,
  top: number,
): number {
  const node = getNode(nodeId);
  if (!node) {
    return top;
  }

  let nextTop = visit(nodeId, node, top);

  if ("children" in node) {
    for (const childId of node.children) {
      nextTop = traverseNodeTree(childId, getNode, visit, nextTop);
    }
  }

  return nextTop;
}

export function traverseRootTrees(
  rootIds: string[],
  getNode: (id: string) => BlockNode | undefined,
  visit: TreeNodeVisitor,
): number {
  let top = 0;

  for (const rootId of rootIds) {
    top = traverseNodeTree(rootId, getNode, visit, top);
  }

  return top;
}

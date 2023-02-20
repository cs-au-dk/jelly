(async function() {
    const { default: fetch } = await import("node-fetch");
    await fetch('someUrl').json();
}())

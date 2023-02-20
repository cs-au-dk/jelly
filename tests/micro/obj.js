const person = {
    printIntroduction: function() {
        console.log("1");
    }
};

const me = Object.create(person);

me.printIntroduction();
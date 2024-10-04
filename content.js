const scanButton = document.getElementById("scan-button");
const urlInput = document.getElementById('url-input');
const resultSection = document.getElementById("result-section");
const deskVersion = document.getElementById("desktop-version")
const mobVersion = document.getElementById("mobile-version")

window.addEventListener('load', function () {
    if (typeof htmlToImage === 'object') {
        console.log('html-to-image is loaded');
    } else {
        console.log('html-to-image is not loaded');
    }

    if (typeof saveAs === 'function') {
        console.log('FileSaver.js is loaded');
    } else {
        console.log('FileSaver.js is not loaded');
    }
});

//mobile/desktop version detector
function detectDeviceByUserAgent() {
    const userAgent = navigator.userAgent.toLowerCase();
    
    // Detect smartphones devices
    const isMobile = /android|webos|iphone|ipad|iemobile|opera mini/.test(userAgent);
    
    // Detect tablets
    const isTablet = /ipad|android(?!.*mobi)/.test(userAgent);
  
    if (isMobile && !isTablet) {
        mobVersion.style.backgroundColor = "blue";
        mobVersion.style.color = "white";
        deskVersion.style.opacity = 0.7
      
    } else {
        deskVersion.style.backgroundColor = "blue";
        deskVersion.style.color = "white";
        mobVersion.style.opacity = 0.7
    }
  }
  
detectDeviceByUserAgent();

// Function to get the active tab's URL
function displayURL() {
    chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
        urlInput.value = tabs[0].url;
        urlInput.style.color = "blue";
    });
}
displayURL();

// Processing the data from the background script
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    const outputJSON = request.bodyContent;
    const blob = new Blob([JSON.stringify(outputJSON, null, 2)], { type: "application/json" });
    const downloadLink = document.createElement("a");
    downloadLink.href = URL.createObjectURL(blob);
    downloadLink.download = "ui_inconsistencies_report.json";
    downloadLink.textContent = "Download The UI Report";
    document.getElementById("result-section").appendChild(downloadLink);
    scanButton.textContent = "Scan Ok!";
});

scanButton.addEventListener('click', async () => {
    let [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: scanForUIInconsistencies
    });
    scanButton.disabled = true;
    scanButton.style.backgroundColor = "#F2F2F2";
    scanButton.style.cursor = 'not-allowed';
    scanButton.style.color = "black";
    scanButton.style.border = "1px solid #F2F2F2";
    scanButton.style.fontWeight = "600";
    scanButton.textContent = "Scanning...";
    resultSection.style.marginBottom = '50px';
});

// Function to scan for UI inconsistencies
function scanForUIInconsistencies() {
    const classElementsMap = {};
    const inconsistentElements = [];

    // Only select elements that have a class attribute
    const classElements = document.querySelectorAll("[class]");
    classElements.forEach((element) => {
        const classNames = String(element.className).trim();  
        const tagName = element.tagName.toLowerCase();
        
        if (classNames) {
            classNames.split(" ").forEach((className) => {
                const key = `${tagName}_${className}`; 
                
                // Only consider elements with both the same class and the same tag name
                if (!classElementsMap[key]) {
                    classElementsMap[key] = [];
                }
                classElementsMap[key].push(element);
            });
        }
    });

    // Function to compare styles between two elements and get only the inconsistencies
    function findStyleInconsistencies(elem1, elem2, styles) {
        const inconsistencies = {};
        styles.forEach(style => {
            const style1 = window.getComputedStyle(elem1)[style];
            const style2 = window.getComputedStyle(elem2)[style];
            if (style1 !== style2) {
                inconsistencies[style] = {
                    element1: style1,
                    element2: style2
                };
            }
        });
        return inconsistencies;
    }

    // Function to get detailed style information of an element
    function getElementDetails(element) {
        const styles = window.getComputedStyle(element);
        const rect = element.getBoundingClientRect();
        const { domPath, componentName } = getDomPath(element);

        return {
            domElement: element,
            domPath,
            componentName,
            coordinates: {
                x: Math.round(rect.x),
                y: Math.round(rect.y)
            },
            size: {
                width: Math.round(rect.width),
                height: Math.round(rect.height)
            },
            padding: {
                left: styles.paddingLeft,
                right: styles.paddingRight,
                top: styles.paddingTop,
                bottom: styles.paddingBottom
            },
            borderRadius: styles.borderRadius,
            color: {
                background: styles.backgroundColor,
                text: styles.color
            },
            border: {
                color: styles.borderColor,
                stroke: styles.borderWidth
            },
            elevation: styles.boxShadow || 'None'
        };
    }

    // Function to get the DOM path and component name
    function getDomPath(element) {
        const path = [];
        let lastElement = element;

        while (element.parentElement) {
            let selector = element.tagName.toLowerCase();
            const className = String(element.className || "").trim();
            
            if (className) {
                const classNames = className.split(" ");
                if (classNames.length > 0) {
                    selector += `.${classNames.join('.')}`;
                }
            }
            path.unshift(selector);
            element = element.parentElement;
        }

        let componentName = lastElement.tagName.toLowerCase();
        const lastClassName = String(lastElement.className || "").trim();  
        if (lastClassName) {
            const classNames = lastClassName.split(" ");
            if (classNames.length > 0) {
                componentName += `.${classNames.join('.')}`;
            }
        }

        const fullDomPath = path.join(" > ") + ` > ${componentName}`;

        return {
            domPath: fullDomPath,
            componentName
        };
    }

    // List of css properties to be compared with elements
    const stylesToCompare = ["color", "padding", "font-size", "background-color", "margin", "border", "width", "height"];

    // Check for inconsistencies among elements with the same class and tag name
    Object.keys(classElementsMap).forEach((key) => {
        const elements = classElementsMap[key];
        for (let i = 0; i < elements.length; i++) {
            for (let j = i + 1; j < elements.length; j++) {
                const inconsistencies = findStyleInconsistencies(elements[i], elements[j], stylesToCompare);
                if (Object.keys(inconsistencies).length > 0) {
                    inconsistentElements.push({
                        className: key.split("_")[1],  
                        element1: getElementDetails(elements[i]),
                        element2: getElementDetails(elements[j]),
                        inconsistencies: inconsistencies
                    });
                }
            }
        }
    });

    // Generate the JSON output for the report, including html-to-image screenshots
    let outputJSON = [];

    if (inconsistentElements.length > 0) {
        const promises = inconsistentElements.map((item, index) => {
            const component1 = item.element1;
            const component2 = item.element2;

            return htmlToImage.toPng(component1.domElement, { skipFonts: true, cacheBust: true, scale: 0.75 }).then((dataUrl1) => {
                component1.imageURL = dataUrl1;

                return htmlToImage.toPng(component2.domElement, { skipFonts: true, cacheBust: true, scale: 0.75 }).then((dataUrl2) => {
                    component2.imageURL = dataUrl2;

                    outputJSON.push({
                        inconsistencyNumber: index + 1,
                        className: item.className,
                        component1: component1,
                        component2: component2,
                        inconsistentStyles: item.inconsistencies
                    });
                });
            });
        });

        // Wait for all promises to resolve before sending the final JSON to the processing script
        Promise.all(promises).then(() => {
            chrome.runtime.sendMessage({
                type: "outputJSON",
                bodyContent: outputJSON
            });
        });
    } else {
        outputJSON.push({
            message: "No UI inconsistencies found."
        });

        chrome.runtime.sendMessage({
            type: "outputJSON",
            bodyContent: outputJSON
        });
    }
}

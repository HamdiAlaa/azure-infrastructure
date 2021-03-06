import * as pulumi from "@pulumi/pulumi";
import * as azure from "@pulumi/azure";

const __ = new pulumi.Config();

//Outputs Declarations
let ipAddressesList: pulumi.Output<String>[] = [];
let dnsOutputArray: pulumi.Output<String>[] = [];
let privateIpList: pulumi.Output<String>[]=[];
let ip: pulumi.Output<String>;
//Create an Azure Resource Group
const resourceGroup = new azure.core.ResourceGroup(`${__.require('cluster_name')}-rsgrp`, {
    location: __.require('location'),
});
const resourceGroupName = resourceGroup.name;
//NetWork
const mainVirtualNetwork = new azure.network.VirtualNetwork("main", {
    addressSpaces: ["10.0.0.0/16"],
    location: resourceGroup.location,
    name: `${__.require('cluster_name')}-network`,
    resourceGroupName: resourceGroup.name,


});
// main network Security group
const network_security_group = new azure.network.NetworkSecurityGroup("rancher_security_group",{
    resourceGroupName:resourceGroup.name,
});
// // ssh INBOUND
// const ssh_inbound_rule = new azure.network.NetworkSecurityRule("ssh_inbound_rule",{
//     destinationPortRange:"22",
//     sourcePortRange:"*",
//     priority:300,
//     protocol:"Tcp",
//     access:"Allow",
//     direction:"Inbound",
//     sourceAddressPrefix:"*",
//     destinationAddressPrefix:"*",
//     networkSecurityGroupName:network_security_group.name,
//     resourceGroupName:resourceGroup.name,

// })

// Network security rule INBOUND
const network_security_rule_inbound = new azure.network.NetworkSecurityRule("rancher_security_rule_inbound",{
    destinationPortRanges:["22","2376","2379","2380","8472","9099","10250","80","443","2376","6443","9099","10254","30000-32767","3389"],
    sourcePortRange:"*",
    priority:100,
    protocol:"*",
    access:"Allow",
    direction:"Inbound",
    sourceAddressPrefix:"*",
    destinationAddressPrefix:"*",
    resourceGroupName:resourceGroup.name,
    networkSecurityGroupName:network_security_group.name,
});

// Network security rule OUTBOUND
const network_security_rule_outbound = new azure.network.NetworkSecurityRule("rancher_security_rule_outbound",{
    destinationPortRanges:["22","6443","443","2379","2380","8472","9099","10250","10254","80"],
    sourcePortRange:"*",
    resourceGroupName:resourceGroup.name,
    access:"Allow",
    direction:"Outbound",
    priority:100,
    protocol:"*",
    networkSecurityGroupName:network_security_group.name,
    sourceAddressPrefix:"*",
    destinationAddressPrefix:"*"

});
//Subnet
const internal = new azure.network.Subnet("internal", {
    addressPrefix: "10.0.2.0/24",
    name: "internal",
    resourceGroupName: resourceGroup.name,
    virtualNetworkName: mainVirtualNetwork.name,
    // networkSecurityGroupId:network_security_group.id
});

// main interface
for (let index = 1; index <= +__.require('node_number'); index++) {

    // Now allocate a public IP and assign it to our NIC.
    const publicIp = new azure.network.PublicIp(`Ip${index}`, {
        resourceGroupName,
        allocationMethod: "Dynamic",
        domainNameLabel:`dns-${__.require('cluster_name')}-${index}`
    });
    // DNS OUTPUT
    dnsOutputArray.push(publicIp.fqdn);

    // MAIN NETWORK
    const mainNetworkInterface = new azure.network.NetworkInterface(`main${index}`, {
        ipConfigurations: [{
            name: `testconfiguration${index}`,
            privateIpAddressAllocation: "Dynamic",
            subnetId: internal.id,
            publicIpAddressId: publicIp.id,
        }],
        location: resourceGroup.location,
        name: `${__.require('cluster_name')}-network-interface-${index}`,
        resourceGroupName: resourceGroup.name,
    });
    privateIpList.push(mainNetworkInterface.privateIpAddress);


    // CREATE VIRTUAL NODE 
    const mainVirtualMachine = new azure.compute.VirtualMachine(`VM-${index}`, {
        location: resourceGroup.location,
        name: `${__.require('cluster_name')}-node-${index}`,
        networkInterfaceIds: [mainNetworkInterface.id],
        osProfile: {
            adminPassword: __.require('password'),
            adminUsername: __.require('username'),
            computerName: `node${index}`,
            customData:` <<-EOF
            #!/bin/sh
            touch index.html
            EOF
            `,
        },
        // plan:{
        //     name:"os154",
        //     product:"rancheros",
        //     publisher:"rancher",           
        // },
        deleteDataDisksOnTermination: true,
        deleteOsDiskOnTermination: true,
        osProfileLinuxConfig: {
            disablePasswordAuthentication: false,
            // sshKeys:[{
            //     keyData:__.require("ssh_key_data"),
            //     path:__.require('key_path')
            // }]
        },
        
        resourceGroupName: resourceGroup.name,
        storageImageReference: {
            offer: __.require('offer'),
            publisher: "Canonical",
            sku: __.require('sku'),
            version: "latest",
            // offer:"rancheros",
            // publisher:"rancher",
            // sku:"os154",
            // version:"1.5.4"

        },
        storageOsDisk: {
            caching: "ReadWrite",
            createOption: "FromImage",
            managedDiskType: "Standard_LRS",
            name: `mytestosdisk${index}`,

        },
        tags: {
            environment: __.require('cluster_name'),
        },
        vmSize: __.require('node_size'),

    });
    // The public IP address is not allocated until the VM is running, so wait for that
    // resource to create, and then lookup the IP address again to report its public IP.
    const done = pulumi.all({ _: mainVirtualMachine.id, name: publicIp.name, resourceGroupName: publicIp.resourceGroupName });
    const ipAddres = done.apply(d => {
        return pulumi.output(azure.network.getPublicIP({ name: d.name, resourceGroupName: d.resourceGroupName },{async:true}).then(ip=>ip.ipAddress));
    });
    ipAddressesList.push(ipAddres);

    // const dns = done.apply(d=>{
    //     return pulumi.output(azure.network.getPublicIP({ name: d.name, resourceGroupName: d.resourceGroupName }));
    // });

}//End Boucle


//EXPORTS
// export const ips = az_infra.ipAddress;
export const ips = ipAddressesList;
export const privateIps = privateIpList;
export const dns = dnsOutputArray;

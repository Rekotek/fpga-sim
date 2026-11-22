// Файл данных, включаемый файл и осциллограмма с именем не по умолчанию.
`include "consts.vh"
module tb_data;
    reg [7:0] rom [0:1];
    reg [7:0] value = 0;
    initial begin
        $dumpfile("waves.vcd");
        $dumpvars(0, tb_data);
        $readmemh("rom.hex", rom);
        #1 value = rom[0];
        #1 value = rom[1];
        #1 $display("rom %h %h answer %0d", rom[0], rom[1], `ANSWER);
        $finish;
    end
endmodule

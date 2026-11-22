// Урок 2, задание 3: голосование большинством из трёх.
// LED0 горит, когда «за» хотя бы два голоса из трёх.
module top (
    input  wire btn_s1,   // кнопка S1, вывод 88, нажата = 1
    input  wire btn_s2,   // кнопка S2, вывод 87, нажата = 1
    input  wire vote3,    // третий голос: провод на выводе 73 (левая гребёнка, контакт 1)
    output wire led0      // LED0, вывод 15, горит при 0
);
    wire a, b, c, yes;
    assign a = btn_s1;
    assign b = btn_s2;
    assign c = vote3;

    assign yes  = (a & b) | (a & c) | (b & c);   // хотя бы двое «за»
    assign led0 = ~yes;                          // светодиод горит по нулю
endmodule
